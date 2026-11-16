import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyDraft, DraftReconciliationService, type MailboxCopy } from '../src/services/draft-reconciliation.js';
import { DraftJournal, draftHash, type DraftReference, type SendAttempt } from '../src/services/draft-state.js';
import { DraftService } from '../src/services/draft-service.js';
import type { ImapAccount } from '../src/types/index.js';

const account: ImapAccount = { id: 'account-a', name: 'A', host: 'imap.example.test', user: 'sender@example.test', password: 'mock-password', port: 993, tls: true };
const DRAFTS = 'Drafts';
const SENT = 'Sent';
const ALL = 'All Mail';
const mime = (id: string, body = 'body') => Buffer.from(`From: sender@example.test\r\nTo: to@example.test\r\nSubject: s\r\nMessage-ID: ${id}\r\n\r\n${body}`);

interface FakeMessage { raw: Buffer; flags: Set<string>; labels: Set<string>; emailId: string; threadId: string; uids: Record<string, number> }

/** Stateful IMAP double. It has no delete, move, expunge or append, so any such call throws. */
class FakeServer {
  messages: FakeMessage[] = [];
  stores: { mailbox: string; uid: number; flags: string[]; options: any }[] = [];
  selected = '';
  readOnly = true;
  storeResult: 'apply' | 'false' | 'throw' | 'applied-then-false' | 'noop' = 'apply';
  afterStore: (() => void) | null = null;
  locks: { path: string; readOnly: boolean }[] = [];
  /** imapflow returns false from search on any command error. */
  failSearch: ((mailbox: string, query: any) => boolean) | null = null;
  disconnectAfterStore = false;
  /** Models Gmail still listing a message in Drafts after its label is gone. */
  pinnedToDrafts = new Set<string>();
  dropped = false;
  uidValidity: Record<string, bigint> = { [DRAFTS]: 42n, [SENT]: 43n, [ALL]: 44n };
  constructor(readonly gmail: boolean) {}
  private inMailbox(m: FakeMessage, mailbox: string) {
    if (m.uids[mailbox] === undefined) return false;
    if (this.gmail && mailbox === DRAFTS) return m.labels.has('\\Draft') || this.pinnedToDrafts.has(m.emailId);
    if (this.gmail && mailbox === SENT) return m.labels.has('\\Sent');
    return true;
  }
  private visible() { return this.messages.filter(m => this.inMailbox(m, this.selected)); }
  matching(query: any) {
    return this.visible().filter(m => {
      if (query.emailId && m.emailId !== query.emailId) return false;
      if (query.header && !m.raw.toString().includes(query.header['message-id'])) return false;
      if (query.draft && !m.flags.has('\\Draft')) return false;
      return !(query.deleted === false && m.flags.has('\\Deleted'));
    }).map(m => m.uids[this.selected]);
  }
  client() {
    const server = this;
    return {
      on: vi.fn(), connect: vi.fn(), logout: vi.fn(), close: vi.fn(),
      get capabilities() { return new Map(server.gmail ? [['X-GM-EXT-1', true]] : []); },
      get mailbox() { return { uidValidity: server.uidValidity[server.selected] }; },
      list: async () => [
        { path: DRAFTS, specialUse: '\\Drafts' }, { path: SENT, specialUse: '\\Sent' },
        ...(server.gmail ? [{ path: ALL, specialUse: '\\All' }] : []),
      ],
      getMailboxLock: async (path: string, options: any) => {
        if (server.dropped) throw new Error('connection closed');
        server.selected = path; server.readOnly = !!options?.readOnly;
        server.locks.push({ path, readOnly: server.readOnly });
        return { release: vi.fn() };
      },
      search: async (query: any, options: any) => {
        if (!options?.uid) throw new Error('search must request UIDs');
        if (server.failSearch?.(server.selected, query)) return false;
        return server.matching(query);
      },
      fetchOne: async (uid: number, query: any, options: any) => {
        if (!options?.uid) throw new Error('fetchOne must address UIDs');

        const m = server.visible().find(v => v.uids[server.selected] === uid);
        if (!m) return false;
        // Gmail omits the selected mailbox's own label from X-GM-LABELS.
        const hidden = server.selected === DRAFTS ? '\\Draft' : server.selected === SENT ? '\\Sent' : '';
        return {
          source: m.raw, flags: new Set(m.flags), emailId: m.emailId, threadId: m.threadId,
          labels: server.gmail ? new Set([...m.labels].filter(l => l !== hidden)) : undefined,
        };
      },
      messageFlagsRemove: async (uid: number, flags: string[], options: any) => {
        if (server.readOnly) throw new Error('STORE in read-only session');
        server.stores.push({ mailbox: server.selected, uid, flags, options });
        if (server.storeResult === 'false') return false;
        if (server.storeResult === 'throw') throw new Error('connection lost');
        if (server.storeResult === 'noop') return true;
        const m = server.visible().find(v => v.uids[server.selected] === uid)!;
        for (const flag of flags) (options?.useLabels ? m.labels : m.flags).delete(flag);
        server.afterStore?.();
        if (server.disconnectAfterStore) server.dropped = true;
        return server.storeResult !== 'applied-then-false';
      },
    };
  }
}

let directory: string;
let journal: DraftJournal;
let server: FakeServer;
let service: DraftReconciliationService;

const useServer = (gmail: boolean) => {
  server = new FakeServer(gmail);
  service = new DraftReconciliationService(journal, () => server.client() as any);
};
const refFor = (uid: number, messageId: string | null): DraftReference => ({ accountId: account.id, mailbox: DRAFTS, uid, uidValidity: '42', messageId });
const claimAttempt = async (ref: DraftReference, raw: Buffer, state: SendAttempt['state'] = 'confirmed') => {
  await journal.claim({ draft: ref, contentHash: draftHash(raw), messageId: ref.messageId ?? '<generated@imap-mcp.local>', startedAt: '2026-11-02T00:00:00.000Z', state });
};
const sharedGmail = (uid = 7, id = '<shared@example.test>') => {
  const raw = mime(id);
  const message: FakeMessage = { raw, flags: new Set(['\\Seen']), labels: new Set(['\\Draft', '\\Sent', 'Clients']), emailId: `gm-${uid}`, threadId: 'th-1', uids: { [DRAFTS]: uid, [SENT]: uid + 100, [ALL]: uid + 200 } };
  server.messages.push(message);
  return { raw, message, ref: refFor(uid, id), hash: draftHash(raw) };
};
const ordinaryResidual = (uid = 7, id = '<plain@example.test>') => {
  const raw = mime(id);
  const draft: FakeMessage = { raw, flags: new Set(['\\Draft', '\\Seen']), labels: new Set(), emailId: '', threadId: '', uids: { [DRAFTS]: uid } };
  const sent: FakeMessage = { raw, flags: new Set(['\\Seen']), labels: new Set(), emailId: '', threadId: '', uids: { [SENT]: uid + 100 } };
  server.messages.push(draft, sent);
  return { raw, draft, sent, ref: refFor(uid, id), hash: draftHash(raw) };
};
const classOf = async (uid: number) => (await service.reconcile(account)).entries.find(e => e.draft.uid === uid)!;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'draft-reconcile-'));
  journal = new DraftJournal(directory);
  useServer(true);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe('dry-run reconciliation', () => {
  it('distinguishes a Gmail shared identity from a genuine unsent draft', async () => {
    const shared = sharedGmail(7);
    await claimAttempt(shared.ref, shared.raw);
    const unsentRaw = mime('<ready@example.test>');
    server.messages.push({ raw: unsentRaw, flags: new Set(['\\Draft']), labels: new Set(['\\Draft']), emailId: 'gm-ready', threadId: 'th-2', uids: { [DRAFTS]: 8, [ALL]: 208 } });
    const report = await service.reconcile(account);
    expect(report).toMatchObject({ dryRun: true, counts: { shared_sent_draft: 1, unsent_draft: 1 }, truncated: false });
    expect(report.entries.find(e => e.draft.uid === 7)).toMatchObject({ classification: 'shared_sent_draft', eligible: true });
    expect(report.entries.find(e => e.draft.uid === 8)).toMatchObject({ classification: 'unsent_draft', eligible: false });
  });
  it('writes nothing to the mailbox or journal', async () => {
    const shared = sharedGmail(7);
    await claimAttempt(shared.ref, shared.raw);
    const before = await journal.get(shared.ref);
    const record = vi.spyOn(journal, 'record');
    await service.reconcile(account);
    expect(server.stores).toEqual([]);
    expect(server.locks.length).toBeGreaterThan(0);
    expect(server.locks.every(l => l.readOnly)).toBe(true);
    expect(record).not.toHaveBeenCalled();
    expect(await journal.get(shared.ref)).toEqual(before);
  });
  it('finds a Gmail draft whose flag is gone but whose label remains', async () => {
    const shared = sharedGmail(7);
    expect(shared.message.flags.has('\\Draft')).toBe(false);
    await claimAttempt(shared.ref, shared.raw);
    expect(await classOf(7)).toMatchObject({ classification: 'shared_sent_draft', eligible: true });
  });
  it('refuses a Gmail message that still has both the Draft flag and label', async () => {
    const shared = sharedGmail(7);
    shared.message.flags.add('\\Draft');
    await claimAttempt(shared.ref, shared.raw);
    expect(await classOf(7)).toMatchObject({ classification: 'uncertain', eligible: false });
    expect(await service.clearStatus(account, shared.ref, shared.hash)).toMatchObject({ success: false, changed: false, classification: 'uncertain' });
    expect(server.stores).toEqual([]);
    expect((await journal.get(shared.ref))?.statusCleanup).toBeUndefined();
  });
  it('holds a message whose send attempt is journaled under another UID', async () => {
    const id = '<moved@example.test>';
    const raw = mime(id);
    server.messages.push({ raw, flags: new Set(), labels: new Set(['\\Draft', '\\Sent']), emailId: 'gm-9', threadId: 't', uids: { [DRAFTS]: 9, [SENT]: 109, [ALL]: 209 } });
    await claimAttempt(refFor(7, id), raw, 'uncertain');
    expect(await classOf(9)).toMatchObject({ classification: 'held', eligible: false, attemptState: null, otherAttemptState: 'uncertain' });
    expect(await service.clearStatus(account, refFor(9, id), draftHash(raw))).toMatchObject({ success: false, changed: false, classification: 'held' });
    expect(server.stores).toEqual([]);
  });
  it.each([[DRAFTS], [SENT], [ALL]])('fails instead of reporting empty when a %s search fails', async mailbox => {
    const shared = sharedGmail(7);
    await claimAttempt(shared.ref, shared.raw);
    server.failSearch = selected => selected === mailbox;
    await expect(service.reconcile(account)).rejects.toThrow('search failed');
  });
  it('fails when a mailbox has no UIDVALIDITY', async () => {
    sharedGmail(7);
    delete (server.uidValidity as any)[DRAFTS];
    await expect(service.reconcile(account)).rejects.toThrow('UIDVALIDITY');
  });
  it('reports a separate Sent copy that carries Draft status', async () => {
    useServer(false);
    const residual = ordinaryResidual(7);
    residual.sent.flags.add('\\Draft');
    await claimAttempt(residual.ref, residual.raw);
    expect((await service.reconcile(account)).draftStatusElsewhere).toEqual([{ mailbox: SENT, uids: [107], total: 1 }]);
  });
  it.each(['prepared', 'failed', 'uncertain', 'partial'] as const)('holds a %s send attempt', async state => {
    const shared = sharedGmail(7);
    await claimAttempt(shared.ref, shared.raw, state);
    expect(await classOf(7)).toMatchObject({ classification: 'held', eligible: false, attemptState: state });
  });
  it('reports a shared identity with no send attempt as unverified', async () => {
    sharedGmail(7);
    expect(await classOf(7)).toMatchObject({ classification: 'sent_unverified', eligible: false });
  });
  it('reports a separate Gmail Sent copy without making it eligible', async () => {
    const id = '<separate@example.test>';
    const raw = mime(id);
    server.messages.push(
      { raw, flags: new Set(['\\Draft']), labels: new Set(['\\Draft']), emailId: 'gm-d', threadId: 'th', uids: { [DRAFTS]: 7, [ALL]: 207 } },
      { raw, flags: new Set(['\\Seen']), labels: new Set(['\\Sent']), emailId: 'gm-s', threadId: 'th', uids: { [SENT]: 107, [ALL]: 307 } },
    );
    await claimAttempt(refFor(7, id), raw);
    expect(await classOf(7)).toMatchObject({ classification: 'separate_sent_copy', eligible: false });
  });
  it('ignores a Sent message whose Message-ID only contains the draft ID', async () => {
    const raw = mime('<a@example.test>');
    server.messages.push(
      { raw, flags: new Set(['\\Draft']), labels: new Set(['\\Draft']), emailId: 'gm-d', threadId: 't', uids: { [DRAFTS]: 7, [ALL]: 207 } },
      { raw: mime('<a@example.test>.other'), flags: new Set(), labels: new Set(['\\Sent']), emailId: 'gm-o', threadId: 't2', uids: { [SENT]: 107, [ALL]: 307 } },
    );
    expect(await classOf(7)).toMatchObject({ classification: 'unsent_draft' });
  });
  it('marks a journaled hash mismatch as uncertain', async () => {
    const shared = sharedGmail(7);
    await claimAttempt(shared.ref, mime('<shared@example.test>', 'other'));
    expect(await classOf(7)).toMatchObject({ classification: 'uncertain', eligible: false });
  });
  it('requires an All Mail copy before treating a message as shared', async () => {
    const shared = sharedGmail(7);
    shared.message.uids = { [DRAFTS]: 7, [SENT]: 107 };
    await claimAttempt(shared.ref, shared.raw);
    expect(await classOf(7)).toMatchObject({ classification: 'uncertain' });
  });
  it('requires All Mail labels to show both Sent and Draft', () => {
    const copy = (mailbox: string, labels: string[]): MailboxCopy => ({ mailbox, uid: 1, uidValidity: '1', messageId: '<i@example.test>', contentHash: 'h', flags: [], labels, emailId: 'gm', threadId: 't' });
    const attempt: SendAttempt = { draft: refFor(1, '<i@example.test>'), contentHash: 'h', messageId: '<i@example.test>', startedAt: '', state: 'confirmed' };
    const decide = (labels: string[]) => classifyDraft({ draft: copy(DRAFTS, []), attempt, locked: false, sent: [copy(SENT, [])], allMail: [copy(ALL, labels)] }, true).classification;
    expect(decide(['\\Sent', '\\Draft'])).toBe('shared_sent_draft');
    expect(decide(['\\Draft'])).toBe('uncertain');
    expect(decide(['\\Sent'])).toBe('uncertain');
  });
  it.each([[{ sentMailbox: ALL }], [{ allMailMailbox: DRAFTS }], [{ draftsMailbox: SENT }]])('rejects mailbox override %j', async overrides => {
    await expect(service.reconcile(account, overrides)).rejects.toThrow(/different mailboxes|is \\/);
  });
  it('fails closed when Gmail All Mail cannot be identified', async () => {
    const client = server.client();
    (client as any).list = async () => [{ path: DRAFTS, specialUse: '\\Drafts' }, { path: SENT, specialUse: '\\Sent' }];
    const noAll = new DraftReconciliationService(journal, () => client as any);
    await expect(noAll.reconcile(account)).rejects.toThrow('All Mail');
  });
  it('reports Draft status outside the Drafts mailbox', async () => {
    server.messages.push({ raw: mime('<x@example.test>'), flags: new Set(['\\Draft']), labels: new Set(['\\Sent']), emailId: 'gm-x', threadId: 't', uids: { [SENT]: 500, [ALL]: 501 } });
    expect((await service.reconcile(account)).draftStatusElsewhere).toEqual([
      { mailbox: SENT, uids: [500], total: 1 }, { mailbox: ALL, uids: [501], total: 1 },
    ]);
  });
  it('reports truncation rather than silently dropping drafts', async () => {
    sharedGmail(7, '<one@example.test>');
    sharedGmail(8, '<two@example.test>');
    expect(await service.reconcile(account, {}, 1)).toMatchObject({ total: 2, scanned: 1, truncated: true });
  });
  it('classifies ordinary IMAP residual, unsent and retired messages', async () => {
    useServer(false);
    const residual = ordinaryResidual(7);
    await claimAttempt(residual.ref, residual.raw);
    server.messages.push(
      { raw: mime('<ready@example.test>'), flags: new Set(['\\Draft']), labels: new Set(), emailId: '', threadId: '', uids: { [DRAFTS]: 8 } },
      { raw: mime('<old@example.test>'), flags: new Set(['\\Seen']), labels: new Set(), emailId: '', threadId: '', uids: { [DRAFTS]: 9 } },
    );
    expect(await classOf(7)).toMatchObject({ classification: 'sent_residual_flag', eligible: true });
    expect(await classOf(8)).toMatchObject({ classification: 'unsent_draft', eligible: false });
    expect(await classOf(9)).toMatchObject({ classification: 'retired', eligible: false });
  });
  it('treats a confirmed send with no Sent copy as unverified on ordinary IMAP', async () => {
    useServer(false);
    const raw = mime('<nosent@example.test>');
    server.messages.push({ raw, flags: new Set(['\\Draft']), labels: new Set(), emailId: '', threadId: '', uids: { [DRAFTS]: 7 } });
    await claimAttempt(refFor(7, '<nosent@example.test>'), raw);
    expect(await classOf(7)).toMatchObject({ classification: 'sent_unverified', eligible: false });
  });
});

describe('clearing Gmail shared identities', () => {
  it('removes only the Draft label through All Mail and verifies everything else', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    const result = await service.clearStatus(account, ref, hash);
    expect(result).toMatchObject({ success: true, changed: true, cleanup: { state: 'verified', operation: 'gmail-label' } });
    expect(server.stores).toEqual([{ mailbox: ALL, uid: 207, flags: ['\\Draft'], options: { uid: true, useLabels: true } }]);
    expect([...message.labels].sort()).toEqual(['Clients', '\\Sent']);
    expect([...message.flags]).toEqual(['\\Seen']);
    expect(message.raw).toBe(raw);
    expect(message).toMatchObject({ emailId: 'gm-7', threadId: 'th-1' });
    expect((await journal.get(ref))?.state).toBe('confirmed');
  });
  it('is idempotent: a repeat call re-reads and never stores again', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await service.clearStatus(account, ref, hash);
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: false, alreadyClean: true });
    expect(server.stores).toHaveLength(1);
  });
  it('stays idempotent after a later unrelated flag or label change', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await service.clearStatus(account, ref, hash);
    message.flags.add('\\Flagged');
    message.labels.add('Later');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: false, alreadyClean: true, cleanup: { state: 'verified' } });
  });
  it('reports without storing if Draft status comes back after verification', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await service.clearStatus(account, ref, hash);
    message.labels.add('\\Draft');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, changed: false, blocked: true, cleanup: { state: 'verified' } });
    expect(server.stores).toHaveLength(1);
  });
  it('checks the hash and reference before re-reading an earlier cleanup', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await service.clearStatus(account, ref, hash);
    await expect(service.clearStatus(account, ref, '0'.repeat(64))).rejects.toThrow('does not match');
    await expect(service.clearStatus(account, { ...ref, messageId: '<other@example.test>' }, hash)).rejects.toThrow('does not match');
  });
  it('reports already clean when the Gmail label was removed elsewhere', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    message.labels.delete('\\Draft');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: false, alreadyClean: true });
    expect(server.stores).toEqual([]);
  });
  it('journals the pre-write record before the store', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    const record = vi.spyOn(journal, 'record');
    let stateAtStore: string | undefined;
    const original = server.client.bind(server);
    const wrapped = new DraftReconciliationService(journal, () => {
      const client: any = original();
      const remove = client.messageFlagsRemove;
      client.messageFlagsRemove = async (...args: any[]) => {
        stateAtStore = (await new DraftJournal(directory).get(ref))?.statusCleanup?.state;
        return remove(...args);
      };
      return client;
    });
    await wrapped.clearStatus(account, ref, hash);
    expect(stateAtStore).toBe('started');
    expect(record).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['refuses', 'false'],
    ['throws', 'throw'],
    ['silently ignores', 'noop'],
  ] as const)('holds without retry when the server %s the store', async (_name, mode) => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.storeResult = mode;
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, changed: null, blocked: true, cleanup: { state: 'uncertain' } });
    expect(server.stores).toHaveLength(1);
    server.storeResult = 'apply';
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, blocked: true, changed: false });
    expect(server.stores).toHaveLength(1);
  });
  it('promotes a held cleanup to verified only when a re-read proves it', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.storeResult = 'noop';
    await service.clearStatus(account, ref, hash);
    message.labels.delete('\\Draft');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: false, alreadyClean: true, cleanup: { state: 'verified' } });
    expect(server.stores).toHaveLength(1);
  });
  it('accepts a store reported as failed once readback proves it applied', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.storeResult = 'applied-then-false';
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, cleanup: { state: 'verified' } });
  });
  it('holds after a lost connection, then promotes on a later re-read without storing', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.storeResult = 'applied-then-false';
    server.disconnectAfterStore = true;
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, changed: null, blocked: true, problems: ['Readback failed.'], cleanup: { state: 'uncertain', reason: expect.stringContaining('unknown') } });
    server.dropped = false;
    server.disconnectAfterStore = false;
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: false, alreadyClean: true, cleanup: { state: 'verified' } });
    expect(server.stores).toHaveLength(1);
  });
  it('does not report verified while the message is still listed in Drafts', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.pinnedToDrafts.add('gm-7');
    const result: any = await service.clearStatus(account, ref, hash);
    expect(result).toMatchObject({ success: false, blocked: true, cleanup: { state: 'uncertain' } });
    expect(result.problems).toEqual([`${DRAFTS}: message is still listed`]);
  });
  it('does not report verified when the post-store Drafts search fails', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.failSearch = (selected, query) => selected === DRAFTS && !!query.emailId && server.stores.length > 0;
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, blocked: true, cleanup: { state: 'uncertain' } });
  });
  it.each([
    ['content', (m: FakeMessage) => { m.raw = Buffer.concat([m.raw, Buffer.from('x')]); }, 'content changed'],
    ['Gmail message ID', (m: FakeMessage) => { m.emailId = 'gm-new'; }, 'message ID changed'],
    ['thread ID', (m: FakeMessage) => { m.threadId = 'th-new'; }, 'thread ID changed'],
  ])('fails verification when the store changes %s', async (_name, mutate, problem) => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.afterStore = () => mutate(message);
    const result: any = await service.clearStatus(account, ref, hash);
    expect(result).toMatchObject({ success: false, blocked: true });
    expect(result.problems).toContain(`${ALL}: ${problem}`);
  });
  it.each([[ALL], [SENT]])('fails verification when %s UIDVALIDITY changes after the store', async mailbox => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.afterStore = () => { server.uidValidity[mailbox] = 99n; };
    const result: any = await service.clearStatus(account, ref, hash);
    expect(result.problems).toContain(`${mailbox}: UIDVALIDITY changed`);
  });
  it('fails verification when the store drops another label', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.afterStore = () => message.labels.delete('Clients');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, blocked: true, problems: [`${ALL}: labels differ from expected`] });
  });
  it('fails verification when the message leaves Sent', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    server.afterStore = () => message.labels.delete('\\Sent');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, blocked: true, cleanup: { state: 'uncertain' } });
  });
  it.each(['sent_unverified', 'unsent_draft'])('refuses a %s message without storing', async expected => {
    const id = '<refuse@example.test>';
    const raw = mime(id);
    server.messages.push({ raw, flags: new Set(['\\Draft']), labels: new Set(expected === 'unsent_draft' ? ['\\Draft'] : ['\\Draft', '\\Sent']), emailId: 'gm-7', threadId: 't', uids: { [DRAFTS]: 7, [SENT]: 107, [ALL]: 207 } });
    expect(await service.clearStatus(account, refFor(7, id), draftHash(raw))).toMatchObject({ success: false, changed: false, classification: expected });
    expect(server.stores).toEqual([]);
    expect(await journal.get(refFor(7, id))).toBeNull();
  });
  it('does not take the send lock for a message with no send attempt', async () => {
    const id = '<ready@example.test>';
    const raw = mime(id);
    server.messages.push({ raw, flags: new Set(['\\Draft']), labels: new Set(['\\Draft']), emailId: 'gm-7', threadId: 't', uids: { [DRAFTS]: 7, [ALL]: 207 } });
    const exclusive = vi.spyOn(journal, 'exclusive');
    expect(await service.clearStatus(account, refFor(7, id), draftHash(raw))).toMatchObject({ success: false, changed: false, classification: 'unsent_draft' });
    expect(exclusive).not.toHaveBeenCalled();
  });
  it('refuses a held send attempt', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw, 'uncertain');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, changed: false, classification: 'held' });
    expect(server.stores).toEqual([]);
    expect((await journal.get(ref))?.statusCleanup).toBeUndefined();
  });
  it('rejects changed content, a wrong account and a changed UIDVALIDITY', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await expect(service.clearStatus(account, ref, draftHash(mime('<other@example.test>')))).rejects.toThrow('changed');
    await expect(service.clearStatus({ ...account, id: 'other' }, ref, hash)).rejects.toThrow('accountId');
    server.uidValidity[DRAFTS] = 99n;
    await expect(service.clearStatus(account, ref, hash)).rejects.toThrow('UIDVALIDITY');
    expect(server.stores).toEqual([]);
  });
  it('does not store when All Mail changes between checks', async () => {
    const { message, raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    let locks = 0;
    const original = server.client.bind(server);
    const racing = new DraftReconciliationService(journal, () => {
      const client: any = original();
      const lock = client.getMailboxLock;
      client.getMailboxLock = async (path: string, options: any) => {
        if (options?.readOnly === false && locks++ === 0) message.labels.add('NewLabel');
        return lock(path, options);
      };
      return client;
    });
    expect(await racing.clearStatus(account, ref, hash)).toMatchObject({ success: false, changed: false });
    expect(server.stores).toEqual([]);
    expect((await journal.get(ref))?.statusCleanup).toBeUndefined();
  });
  it('fails closed on a retained local lock', async () => {
    const { raw, ref, hash } = sharedGmail(7);
    await claimAttempt(ref, raw);
    await journal.exclusive(ref, async () => {
      await expect(service.clearStatus(account, ref, hash)).rejects.toThrow('already active');
      expect(await classOf(7)).toMatchObject({ classification: 'held' });
    });
    expect(server.stores).toEqual([]);
  });
});

describe('clearing ordinary IMAP residual flags', () => {
  beforeEach(() => useServer(false));
  it('removes only the flag, in Drafts, and says the message stays there', async () => {
    const { draft, sent, raw, ref, hash } = ordinaryResidual(7);
    await claimAttempt(ref, raw);
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: true, remainsInMailbox: DRAFTS, cleanup: { state: 'verified', operation: 'imap-flag' } });
    expect(server.stores).toEqual([{ mailbox: DRAFTS, uid: 7, flags: ['\\Draft'], options: { uid: true } }]);
    expect([...draft.flags]).toEqual(['\\Seen']);
    expect([...sent.flags]).toEqual(['\\Seen']);
    expect(draft.uids[DRAFTS]).toBe(7);
  });
  it('is idempotent after success and after an external clear', async () => {
    const first = ordinaryResidual(7);
    await claimAttempt(first.ref, first.raw);
    await service.clearStatus(account, first.ref, first.hash);
    expect(await service.clearStatus(account, first.ref, first.hash)).toMatchObject({ success: true, changed: false, alreadyClean: true });
    const second = ordinaryResidual(8, '<second@example.test>');
    second.draft.flags.delete('\\Draft');
    await claimAttempt(second.ref, second.raw);
    expect(await service.clearStatus(account, second.ref, second.hash)).toMatchObject({ success: true, changed: false, alreadyClean: true, classification: 'retired' });
    expect(server.stores).toHaveLength(1);
  });
  it('refuses an unsent draft and leaves it fully intact', async () => {
    const id = '<ready@example.test>';
    const raw = mime(id);
    const ready: FakeMessage = { raw, flags: new Set(['\\Draft']), labels: new Set(), emailId: '', threadId: '', uids: { [DRAFTS]: 7 } };
    server.messages.push(ready);
    expect(await service.clearStatus(account, refFor(7, id), draftHash(raw))).toMatchObject({ success: false, changed: false, classification: 'unsent_draft' });
    expect([...ready.flags]).toEqual(['\\Draft']);
    expect(server.stores).toEqual([]);
  });
  it('ignores a session-only Recent flag when comparing flags', async () => {
    const { draft, raw, ref, hash } = ordinaryResidual(7);
    await claimAttempt(ref, raw);
    draft.flags.add('\\Recent');
    server.afterStore = () => draft.flags.delete('\\Recent');
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: true, changed: true, cleanup: { state: 'verified' } });
  });
  it('holds when the flag survives the store', async () => {
    const { raw, ref, hash } = ordinaryResidual(7);
    await claimAttempt(ref, raw);
    server.storeResult = 'noop';
    expect(await service.clearStatus(account, ref, hash)).toMatchObject({ success: false, blocked: true, problems: [`${DRAFTS}: flags differ from expected`] });
  });
  it('fails closed when the Sent mailbox cannot be identified', async () => {
    const client = server.client();
    (client as any).list = async () => [{ path: DRAFTS, specialUse: '\\Drafts' }];
    const noSent = new DraftReconciliationService(journal, () => client as any);
    await expect(noSent.reconcile(account)).rejects.toThrow('not identified');
  });
  it('rejects a reference outside the Drafts mailbox', async () => {
    const { raw, ref, hash } = ordinaryResidual(7);
    await claimAttempt(ref, raw);
    await expect(service.clearStatus(account, { ...ref, mailbox: SENT }, hash)).rejects.toThrow('not in the Drafts');
  });
});

describe('send path cleanup readback', () => {
  const sendWith = async (flagsAfter: () => Set<string> | false | undefined) => {
    const raw = mime('<send@example.test>');
    const ref = refFor(7, '<send@example.test>');
    let removed = false;
    const client: any = {
      mailbox: { uidValidity: 42n }, on: vi.fn(), connect: vi.fn(), logout: vi.fn(), close: vi.fn(),
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetchOne: vi.fn(async () => {
        if (!removed) return { source: raw, flags: new Set(['\\Draft']) };
        const flags = flagsAfter();
        return flags ? { source: raw, flags } : flags;
      }),
      messageFlagsRemove: vi.fn(async () => { removed = true; return true; }),
    };
    const smtp: any = { createTransporter: vi.fn(async () => ({ sendMail: vi.fn(async () => ({ accepted: ['to@example.test'], rejected: [] })) })) };
    const drafts = new DraftService(smtp, {} as any, journal, () => client);
    return drafts.send({ ...account, saveToSent: false }, ref, draftHash(raw));
  };
  it('reports marked once the flag is confirmed gone', async () => {
    expect(await sendWith(() => new Set())).toMatchObject({ success: true, attempt: { state: 'confirmed', cleanup: 'marked' } });
  });
  it('reports marked when the message has left the mailbox', async () => {
    expect(await sendWith(() => false)).toMatchObject({ success: true, attempt: { cleanup: 'marked' } });
  });
  it('stays pending when the session dropped and fetchOne returns undefined', async () => {
    expect(await sendWith(() => undefined)).toMatchObject({ success: true, attempt: { cleanup: 'pending' } });
  });
  it('stays pending, with send still successful, when the flag survives', async () => {
    expect(await sendWith(() => new Set(['\\Draft']))).toMatchObject({ success: true, attempt: { state: 'confirmed', cleanup: 'pending' } });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { SmtpService } from '../src/services/smtp-service.js';
import { ImapService } from '../src/services/imap-service.js';
import { DraftService, transportMessage } from '../src/services/draft-service.js';
import { DraftJournal, draftIdentity, type DraftReference } from '../src/services/draft-state.js';
import { draftTools } from '../src/tools/draft-tools.js';
import { emailTools } from '../src/tools/email-tools.js';
import type { ImapAccount } from '../src/types/index.js';

const account: ImapAccount = { id: 'account-a', name: 'A', host: 'imap.example.test', user: 'sender@example.test', password: 'mock-password', port: 993, tls: true, saveToSent: false };
let directory: string;
let smtp: SmtpService;
let raw: Buffer;
let ref: DraftReference;
let hash: string;
let journal: DraftJournal;
let service: DraftService;
let client: any;
let sendMail: ReturnType<typeof vi.fn>;
let appendToSentFolder: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'saved-drafts-'));
  smtp = new SmtpService();
  raw = await smtp.composeRaw(account, {
    to: 'recipient@example.test', cc: 'cc@example.test', bcc: 'hidden@example.test', subject: 'Review me',
    text: 'original body', html: '<p>original body<img src="cid:image-1"></p>',
    inReplyTo: '<parent@example.test>', references: ['<root@example.test>', '<parent@example.test>'],
    attachments: [
      { filename: 'binary.dat', content: Buffer.from([0, 255, 13, 10, 128]), contentType: 'application/octet-stream' },
      { filename: 'inline.png', content: Buffer.from([137, 80, 78, 71]), contentType: 'image/png', cid: 'image-1', contentDisposition: 'inline' },
    ],
  });
  const identity = await draftIdentity(account.id, 'Drafts', 7, '42', raw);
  ref = identity.draft; hash = identity.contentHash;
  client = {
    mailbox: { uidValidity: 42n }, on: vi.fn(), connect: vi.fn(), logout: vi.fn(), close: vi.fn(),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(async () => [7]),
    fetchOne: vi.fn(async () => ({ source: raw, flags: new Set(['\\Draft']) })),
    append: vi.fn(async () => ({ uid: 8, uidValidity: 42n })),
    messageFlagsRemove: vi.fn(async () => true),
  };
  sendMail = vi.fn(async () => ({ accepted: ['recipient@example.test', 'cc@example.test', 'hidden@example.test'], rejected: [] }));
  vi.spyOn(smtp, 'createTransporter').mockResolvedValue({ sendMail } as any);
  appendToSentFolder = vi.fn(async () => ({ saved: true }));
  journal = new DraftJournal(directory);
  service = new DraftService(smtp, { appendToSentFolder } as any, journal, () => client);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe('saved draft mocked IMAP/SMTP integration', () => {
  it.each(['\n', '\r'].flatMap(ending => ['Bcc', 'From', 'Message-ID', 'Resent-To'].map(field => ({ ending, field }))))('rejects malformed $field boundary $ending before send claim or edit APPEND', async ({ ending, field }) => {
    raw = Buffer.concat([Buffer.from(`X-Note: synthetic${ending}${field}: hidden@example.test\r\n`), raw]);
    const malformed = await draftIdentity(account.id, ref.mailbox, ref.uid, ref.uidValidity, raw);
    const claim = vi.spyOn(journal, 'claim');
    await expect(service.send(account, malformed.draft, malformed.contentHash)).rejects.toThrow('lone CR or LF');
    await expect(service.update(account, malformed.draft, malformed.contentHash, { subject: 'Edited' })).rejects.toThrow('lone CR or LF');
    expect(claim).not.toHaveBeenCalled();
    expect(smtp.createTransporter).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(client.append).not.toHaveBeenCalled();
    expect(await journal.get(malformed.draft)).toBeNull();
  });
  it('lists stable references, reads all content and never sets Seen', async () => {
    expect((await service.list(account, 'Drafts')).drafts[0]).toMatchObject({ draft: ref, contentHash: hash });
    const result = await service.read(account, ref);
    expect(Buffer.from(result.rawMimeBase64, 'base64')).toEqual(raw);
    expect(result.attachments).toHaveLength(2);
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    expect(client.fetchOne).toHaveBeenCalledWith(7, { source: true, flags: true }, { uid: true });
  });
  it('sends exact saved MIME body, envelope Bcc, attachments and threading', async () => {
    const result = await service.send(account, ref, hash);
    expect(result.success).toBe(true);
    const sent = sendMail.mock.calls[0][0] as any;
    expect(sent.envelope).toEqual({ from: account.user, to: ['recipient@example.test', 'cc@example.test', 'hidden@example.test'] });
    expect(sent.raw.subarray(sent.raw.indexOf('\r\n\r\n') + 4)).toEqual(raw.subarray(raw.indexOf('\r\n\r\n') + 4));
    const parsed = await simpleParser(sent.raw);
    expect(parsed.bcc).toBeUndefined();
    expect(parsed.messageId).toBe(ref.messageId);
    expect(parsed.inReplyTo).toBe('<parent@example.test>');
    expect(parsed.references).toEqual(['<root@example.test>', '<parent@example.test>']);
    expect(parsed.attachments.find(a => a.filename === 'binary.dat')!.content).toEqual(Buffer.from([0, 255, 13, 10, 128]));
    expect(parsed.attachments.find(a => a.filename === 'inline.png')!.cid).toBe('image-1');
    expect(client.messageFlagsRemove).toHaveBeenCalledWith(7, ['\\Draft'], { uid: true });
    expect(appendToSentFolder).not.toHaveBeenCalled();
  });
  it('persists the pre-send identity before SMTP starts, and blocks after restart', async () => {
    sendMail.mockImplementation(async () => {
      expect(await new DraftJournal(directory).get(ref)).toMatchObject({ state: 'prepared', messageId: ref.messageId, contentHash: hash });
      return { accepted: ['recipient@example.test', 'cc@example.test', 'hidden@example.test'], rejected: [] };
    });
    await service.send(account, ref, hash);
    const restarted = new DraftService(smtp, {} as any, new DraftJournal(directory), () => client);
    expect(await restarted.send(account, ref, hash)).toMatchObject({ blocked: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const filename = (await readdir(directory)).find(f => f.endsWith('.json'))!;
    const stored = await readFile(join(directory, filename), 'utf8');
    expect(stored).not.toContain('original body');
    expect((await stat(join(directory, filename))).mode & 0o777).toBe(0o600);
  });
  it.each(['connection lost after DATA', '550 rejected'])('retains draft and prevents retries after %s', async error => {
    sendMail.mockRejectedValue(new Error(error));
    expect(await service.send(account, ref, hash)).toMatchObject({ success: false, attempt: { state: 'uncertain' } });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    expect(await service.send(account, ref, hash)).toMatchObject({ blocked: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('records a known pre-submission failure without calling sendMail', async () => {
    vi.mocked(smtp.createTransporter).mockRejectedValue(new Error('authentication failed'));
    expect(await service.send(account, ref, hash)).toMatchObject({ success: false, attempt: { state: 'failed' } });
    expect(sendMail).not.toHaveBeenCalled();
    expect(await service.send(account, ref, hash)).toMatchObject({ blocked: true });
  });
  it('preserves Bcc in optional Sent copy without exposing it on the wire', async () => {
    await service.send({ ...account, saveToSent: true, sentFolder: 'Sent Items' }, ref, hash);
    const stored = appendToSentFolder.mock.calls[0];
    expect(stored[0]).toBe(account.id); expect(stored[2]).toBe('Sent Items');
    expect((await simpleParser(stored[1])).bcc).toBeDefined();
    expect((await simpleParser((sendMail.mock.calls[0][0] as any).raw)).bcc).toBeUndefined();
  });
  it('keeps CID URLs when only the text body is edited', async () => {
    await service.update(account, ref, hash, { text: 'new plain text' });
    const updated = await simpleParser(client.append.mock.calls[0][1], { skipImageLinks: true });
    expect(updated.html).toContain('cid:image-1');
    expect(updated.html).not.toContain('data:image/');
  });
  it('retains and blocks partial recipient acceptance', async () => {
    sendMail.mockResolvedValue({ accepted: ['recipient@example.test'], rejected: ['cc@example.test'] });
    expect(await service.send(account, ref, hash)).toMatchObject({ success: false, attempt: { state: 'partial' } });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    expect(await service.send(account, ref, hash)).toMatchObject({ blocked: true });
  });
  it('blocks send and update of changed content', async () => {
    raw = Buffer.concat([raw, Buffer.from('changed')]);
    await expect(service.send(account, ref, hash)).rejects.toThrow('content changed');
    await expect(service.update(account, ref, hash, { subject: 'new' })).rejects.toThrow('content changed');
    expect(sendMail).not.toHaveBeenCalled(); expect(client.append).not.toHaveBeenCalled();
  });
  it('rejects changed UIDVALIDITY, Message-ID, deleted and inactive drafts', async () => {
    client.mailbox.uidValidity = 43n;
    await expect(service.read(account, ref)).rejects.toThrow('UIDVALIDITY');
    client.mailbox.uidValidity = 42n;
    await expect(service.read(account, { ...ref, messageId: '<wrong@example.test>' })).rejects.toThrow('Message-ID');
    client.fetchOne.mockResolvedValue({ source: raw, flags: new Set(['\\Draft', '\\Deleted']) });
    await expect(service.send(account, ref, hash)).rejects.toThrow('no longer active');
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('isolates identical mailbox/UID identities across accounts', async () => {
    await expect(service.send({ ...account, id: 'account-b' }, ref, hash)).rejects.toThrow('accountId');
    await service.send(account, ref, hash);
    const b = { ...account, id: 'account-b' };
    expect(await service.send(b, { ...ref, accountId: b.id }, hash)).toMatchObject({ success: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect((await readdir(directory)).filter(f => f.endsWith('.json'))).toHaveLength(2);
  });
  it('uses separate selected-account connections for identical mailbox UIDs', async () => {
    const second = { ...account, id: 'account-b', user: 'second@example.test' };
    const rawB = await smtp.composeRaw(second, { to: 'other@example.test', subject: 'B', text: 'account B only' });
    const identityB = await draftIdentity(second.id, 'Drafts', 7, '42', rawB);
    const clientB = { ...client, fetchOne: vi.fn(async () => ({ source: rawB, flags: new Set(['\\Draft']) })) };
    const factory = vi.fn(selected => selected.id === second.id ? clientB : client);
    const isolated = new DraftService(smtp, {} as any, journal, factory);
    sendMail.mockImplementation(async (mail: any) => ({ accepted: mail.envelope.to, rejected: [] }));
    await isolated.send(account, ref, hash);
    await isolated.send(second, identityB.draft, identityB.contentHash);
    expect(factory.mock.calls.map(call => call[0].id)).toEqual([account.id, second.id]);
    const sentB = sendMail.mock.calls[1][0] as any;
    expect(sentB.envelope.from).toBe(second.user);
    expect((await simpleParser(sentB.raw)).text).toContain('account B only');
  });
  it('blocks the same message copied to another mailbox or UID', async () => {
    await service.send(account, ref, hash);
    expect(await service.send(account, { ...ref, mailbox: 'Other Drafts', uid: 99 }, hash)).toMatchObject({ blocked: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('does not treat missing recipient acknowledgments as full success', async () => {
    sendMail.mockResolvedValue({ accepted: ['recipient@example.test'], rejected: [] });
    expect(await service.send(account, ref, hash)).toMatchObject({ success: false, attempt: { state: 'partial' } });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
  });
  it('prevents concurrent sends across service instances sharing the journal', async () => {
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>(r => { started = r; });
    sendMail.mockImplementation(async () => { started(); await new Promise<void>(r => { release = r; }); return { accepted: ['recipient@example.test', 'cc@example.test', 'hidden@example.test'], rejected: [] }; });
    const first = service.send(account, ref, hash);
    await begun;
    const second = new DraftService(smtp, {} as any, new DraftJournal(directory), () => client);
    await expect(second.send(account, ref, hash)).rejects.toThrow('already active');
    release(); await first;
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('reports confirmed delivery despite cleanup and Sent-copy failures', async () => {
    client.messageFlagsRemove.mockRejectedValue(new Error('failed'));
    appendToSentFolder.mockRejectedValue(new Error('failed'));
    expect(await service.send({ ...account, saveToSent: true }, ref, hash)).toMatchObject({ success: true, attempt: { state: 'confirmed', cleanup: 'pending', sentCopy: { saved: false } } });
    expect(await service.send(account, ref, hash)).toMatchObject({ blocked: true });
  });
  it('leaves a changed draft untouched after SMTP success', async () => {
    sendMail.mockImplementation(async () => { raw = Buffer.concat([raw, Buffer.from('changed')]); return { accepted: ['recipient@example.test', 'cc@example.test', 'hidden@example.test'], rejected: [] }; });
    expect(await service.send(account, ref, hash)).toMatchObject({ success: true, attempt: { cleanup: 'pending' } });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
  });
  it('generates and journals a missing Message-ID before sending', async () => {
    raw = Buffer.from(raw.toString().replace(/^Message-ID:.*\r\n/im, ''));
    const identity = await draftIdentity(account.id, ref.mailbox, ref.uid, ref.uidValidity, raw);
    expect(identity.draft.messageId).toBeNull();
    const result = await service.send(account, identity.draft, identity.contentHash);
    expect(result.attempt?.messageId).toMatch(/@imap-mcp.local>$/);
    expect((await simpleParser((sendMail.mock.calls[0][0] as any).raw)).messageId).toBe(result.attempt?.messageId);
  });
  it('preserves attachments, inline images and thread headers while updating bodies', async () => {
    const result = await service.update(account, ref, hash, { text: 'revised body', html: '<p>revised<img src="cid:image-1"></p>' });
    expect(result).toMatchObject({ success: true, draft: { ...ref, uid: 8 }, originalRetained: true, originalActive: false });
    const replacement = await simpleParser(client.append.mock.calls[0][1]);
    const before = await simpleParser(raw);
    expect(replacement.text).toContain('revised body');
    expect(replacement.attachments.map(a => a.content)).toEqual(before.attachments.map(a => a.content));
    expect(replacement.attachments.find(a => a.filename === 'inline.png')!.cid).toBe('image-1');
    expect(replacement.attachments.find(a => a.filename === 'inline.png')!.contentDisposition).toBe('inline');
    expect(replacement.references).toEqual(before.references);
    expect(replacement.inReplyTo).toEqual(before.inReplyTo);
    expect(replacement.bcc).toEqual(before.bcc);
  });
  it('preserves MIME bytes for header-only edits and clears Bcc explicitly', async () => {
    await service.update(account, ref, hash, { subject: 'revised', bcc: [] });
    const replacement = client.append.mock.calls[0][1];
    expect(replacement.subarray(replacement.indexOf('\r\n\r\n') + 4)).toEqual(raw.subarray(raw.indexOf('\r\n\r\n') + 4));
    expect((await simpleParser(replacement)).subject).toBe('revised');
    expect((await simpleParser(replacement)).bcc).toBeUndefined();
  });
  it('retains the original when append or retirement cannot be confirmed', async () => {
    client.append.mockRejectedValueOnce(new Error('APPEND uncertain'));
    await expect(service.update(account, ref, hash, { subject: 'revised' })).rejects.toThrow('APPEND');
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    client.append.mockResolvedValueOnce({});
    expect(await service.update(account, ref, hash, { subject: 'revised' })).toMatchObject({ replacementUnresolved: true });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    client.messageFlagsRemove.mockRejectedValue(new Error('failed'));
    expect(await service.update(account, ref, hash, { subject: 'revised' })).toMatchObject({ originalActive: true, draft: { uid: 8 } });
  });
  it('does not claim success or retire the source when APPEND returns false', async () => {
    client.append.mockResolvedValue(false);
    await expect(service.update(account, ref, hash, { subject: 'new' })).rejects.toThrow('APPEND failed');
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
  });
  it('does not retire an old UID after an APPEND changes UIDVALIDITY', async () => {
    client.append.mockResolvedValue({ uid: 8, uidValidity: 43n });
    expect(await service.update(account, ref, hash, { subject: 'new' })).toMatchObject({ originalActive: true, draft: { uidValidity: '43' } });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
  });
  it('does not edit a draft with any recorded send attempt', async () => {
    sendMail.mockRejectedValue(new Error('uncertain'));
    await service.send(account, ref, hash);
    await expect(service.update(account, ref, hash, { subject: 'revised' })).rejects.toThrow('send attempt');
  });
  it('fails closed if durable pre-send recording fails', async () => {
    vi.spyOn(journal, 'claim').mockRejectedValue(new Error('disk full'));
    await expect(service.send(account, ref, hash)).rejects.toThrow('disk full');
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('blocks retries if recording SMTP acceptance fails', async () => {
    vi.spyOn(journal, 'record').mockRejectedValue(new Error('disk full'));
    expect(await service.send(account, ref, hash)).toMatchObject({ success: false, attempt: { state: 'uncertain' } });
    expect(await journal.get(ref)).toMatchObject({ state: 'prepared' });
    expect(await service.send(account, ref, hash)).toMatchObject({ blocked: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported resent headers before SMTP', async () => {
    expect(() => transportMessage(Buffer.concat([Buffer.from('Resent-To: other@example.test\r\n'), raw]), ref.messageId!)).toThrow('Resent');
  });
});

describe('tool and APPEND integration', () => {
  it('returns append UID/UIDVALIDITY without breaking legacy appendMessage', async () => {
    const imap = new ImapService();
    vi.spyOn(imap as any, 'ensureConnected').mockResolvedValue(client);
    expect(await imap.appendDraft(account.id, 'Drafts', raw)).toMatchObject({ draft: { ...ref, uid: 8 }, contentHash: hash });
    expect(await imap.appendMessage(account.id, 'Drafts', raw)).toBe(true);
    client.append.mockResolvedValue({});
    expect(await imap.appendDraft(account.id, 'Drafts', raw)).toMatchObject({ draft: null });
  });
  it('exposes identity on existing save tool and routes new tools by reference account', async () => {
    const handlers: Record<string, Function> = {};
    const server = { registerTool: (name: string, _: unknown, handler: Function) => { handlers[name] = handler; } };
    const accounts = { resolveAccountId: () => account.id, getAccount: vi.fn(async () => account) };
    const imap = { appendDraft: vi.fn(async () => ({ draft: ref, contentHash: hash })), findDraftsFolder: async () => 'Drafts' };
    emailTools(server as any, imap as any, accounts as any, smtp);
    const saved = JSON.parse((await handlers.imap_save_draft({ accountId: account.id, to: 'recipient@example.test', text: 'body' })).content[0].text);
    expect(saved).toMatchObject({ success: true, folder: 'Drafts', draft: ref, contentHash: hash });
    draftTools(server as any, imap as any, accounts as any, smtp, service);
    expect(JSON.parse((await handlers.imap_read_draft({ draft: ref })).content[0].text)).toMatchObject({ draft: ref, contentHash: hash });
    expect(accounts.getAccount).toHaveBeenLastCalledWith(account.id);
    await expect(handlers.imap_read_draft({ draft: { ...ref, accountId: 'wrong' } })).rejects.toThrow('not found');
  });
});

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ImapAccount } from '../types/index.js';
import { DraftJournal, draftHash, type DraftReference, type SendAttempt, type StatusCleanup, type StatusCopy } from './draft-state.js';
import { assertCredentialsResolved } from '../utils/env-credentials.js';

export type DraftClass =
  | 'unsent_draft'         // no evidence of sending: never touched
  | 'held'                 // journal attempt or local lock forbids action
  | 'shared_sent_draft'    // Gmail: one message in both Sent and Drafts; eligible
  | 'sent_residual_flag'   // ordinary IMAP: separate Sent copy, Draft flag left over; eligible
  | 'separate_sent_copy'   // Gmail: Sent copy is a different message; report only
  | 'sent_unverified'      // Sent and the journal disagree or one is missing; report only
  | 'retired'              // ordinary IMAP: already has no Draft flag; nothing to do
  | 'uncertain';           // ambiguous evidence; report only

const ELIGIBLE: readonly DraftClass[] = ['shared_sent_draft', 'sent_residual_flag'];
const DRAFT = '\\Draft';

export interface MailboxCopy extends StatusCopy { messageId: string | null }
export interface Mailboxes { drafts: string; sent: string; allMail: string | null; gmail: boolean }
export interface MailboxOverrides { draftsMailbox?: string; sentMailbox?: string; allMailMailbox?: string }
export interface Evidence {
  draft: MailboxCopy;
  attempt: SendAttempt | null;
  /** Attempt with this Message-ID or content journaled under a different reference. */
  otherAttempt?: SendAttempt | null;
  locked: boolean;
  sent: MailboxCopy[];
  allMail: MailboxCopy[];
}

const sameSet = (a: string[] | undefined, b: string[] | undefined) =>
  !!a && !!b && a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');
const without = (values: string[] | undefined, value: string) => (values ?? []).filter(v => v !== value);

/** Pure decision: anything other than the exact eligible evidence is left alone. */
export function classifyDraft(e: Evidence, gmail: boolean): { classification: DraftClass; eligible: boolean; reason: string } {
  const done = (classification: DraftClass, reason: string) => ({ classification, eligible: ELIGIBLE.includes(classification), reason });
  const { draft, attempt, otherAttempt, sent, allMail } = e;
  if (e.locked) return done('held', 'A draft operation lock is present; reconcile it first.');
  if (otherAttempt) return done('held', `A ${otherAttempt.state} send attempt exists under another reference; no-retry hold preserved.`);
  if (attempt && attempt.state !== 'confirmed') return done('held', `Send attempt is ${attempt.state}; no-retry hold preserved.`);
  if (attempt?.statusCleanup && attempt.statusCleanup.state !== 'verified') return done('held', `Earlier cleanup is ${attempt.statusCleanup.state}; it will only be re-read, never repeated.`);
  if (attempt && attempt.contentHash !== draft.contentHash) return done('uncertain', 'Draft content differs from the journaled send.');
  if (attempt && draft.messageId && attempt.messageId !== draft.messageId) return done('uncertain', 'Draft Message-ID differs from the journaled send.');

  if (gmail) {
    // Membership of the Gmail Drafts mailbox is the status: the flag can be gone while the label stays.
    if (!draft.emailId) return done('uncertain', 'Server returned no Gmail message ID.');
    const shared = sent.filter(c => c.emailId === draft.emailId);
    if (shared.length > 1) return done('uncertain', 'Gmail message ID appears more than once in Sent.');
    if (shared.length === 1) {
      if (!attempt) return done('sent_unverified', 'In Sent and Drafts, but no local send attempt confirms it.');
      if (shared[0].contentHash !== draft.contentHash) return done('uncertain', 'Sent and Drafts views of one Gmail message differ.');
      const all = allMail.filter(c => c.emailId === draft.emailId);
      if (all.length !== 1) return done('uncertain', 'Expected exactly one All Mail copy.');
      const [copy] = all;
      if (copy.contentHash !== draft.contentHash) return done('uncertain', 'All Mail copy differs from Drafts.');
      if (!copy.threadId || copy.threadId !== shared[0].threadId) return done('uncertain', 'Thread ID is missing or differs across mailboxes.');
      if (!copy.labels?.includes(DRAFT) || !copy.labels.includes('\\Sent')) return done('uncertain', 'All Mail labels do not show both Sent and Draft.');
      // The effect of a label store on a surviving flag is unknown, so refuse before writing.
      if ([draft, shared[0], copy].some(c => c.flags.includes(DRAFT))) return done('uncertain', 'Message still has the Draft flag as well as the label.');
      return done('shared_sent_draft', 'One Gmail message with Sent and Draft status, and a confirmed send attempt.');
    }
    if (sent.length) return done(attempt ? 'separate_sent_copy' : 'sent_unverified', 'Sent has a different message with this Message-ID.');
    if (attempt) return done('sent_unverified', 'Send attempt confirmed, but no Sent copy was found.');
    return done('unsent_draft', 'No send attempt and nothing in Sent.');
  }

  if (!draft.flags.includes(DRAFT)) return done('retired', 'No Draft flag; nothing to clear.');
  if (sent.length > 1) return done('uncertain', 'More than one Sent copy has this Message-ID.');
  if (sent.length === 1) {
    if (!attempt) return done('sent_unverified', 'In Sent, but no local send attempt confirms it.');
    return done('sent_residual_flag', 'Confirmed send with a Sent copy; only the Draft flag is left over.');
  }
  if (attempt) return done('sent_unverified', 'Send attempt confirmed, but no Sent copy was found.');
  return done('unsent_draft', 'No send attempt and nothing in Sent.');
}

const defaultClient = (account: ImapAccount) => new ImapFlow({
  host: account.host, port: account.port, secure: account.tls,
  tls: { host: account.host },
  ...(account.allowStartTLS === false ? { doSTARTTLS: false } : {}),
  auth: { user: account.user, pass: account.password, loginMethod: account.loginMethod }, logger: false,
});

/** imapflow reports a failed SEARCH as false; that must never read as "no matches". */
async function uidsMatching(client: ImapFlow, query: Parameters<ImapFlow['search']>[0]): Promise<number[]> {
  const ids = await client.search(query, { uid: true });
  if (!Array.isArray(ids)) throw new Error('Mailbox search failed. Nothing was concluded from it.');
  return ids;
}
function currentUidValidity(client: ImapFlow): string {
  const value = client.mailbox && client.mailbox.uidValidity;
  if (value === undefined || value === null) throw new Error('Server gave no UIDVALIDITY. Nothing was concluded from this mailbox.');
  return String(value);
}

/**
 * Finds and clears Draft status left on already-sent messages. Never deletes,
 * moves, expunges, appends or sends; the only write is one Draft STORE.
 */
export class DraftReconciliationService {
  constructor(
    readonly journal = new DraftJournal(),
    private clientFactory: (account: ImapAccount) => ImapFlow = defaultClient,
  ) {}

  private async connected<T>(account: ImapAccount, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    assertCredentialsResolved(account, 'imap');
    const client = this.clientFactory(account);
    client.on('error', () => {}); // never log raw server errors or message content
    try {
      await client.connect();
      return await fn(client);
    } finally { try { await client.logout(); } catch { client.close(); } }
  }
  private async inMailbox<T>(client: ImapFlow, mailbox: string, fn: () => Promise<T>, readOnly = true): Promise<T> {
    const lock = await client.getMailboxLock(mailbox, { readOnly });
    try { return await fn(); } finally { lock.release(); }
  }
  private async resolveMailboxes(client: ImapFlow, account: ImapAccount, o: MailboxOverrides): Promise<Mailboxes> {
    const list = await client.list();
    const special = (flag: string) => list.find(f => f.specialUse === flag)?.path;
    const gmail = !!client.capabilities?.has('X-GM-EXT-1');
    const drafts = o.draftsMailbox ?? special('\\Drafts');
    const sent = o.sentMailbox ?? account.sentFolder ?? special('\\Sent');
    const allMail = o.allMailMailbox ?? special('\\All') ?? null;
    if (!drafts || !sent) throw new Error('Drafts or Sent mailbox not identified; pass it explicitly. Nothing was changed.');
    if (new Set([drafts, sent, allMail ?? sent]).size !== (allMail ? 3 : 2)) throw new Error('Drafts, Sent and All Mail must be different mailboxes. Nothing was changed.');
    for (const [path, role] of [[drafts, '\\Drafts'], [sent, '\\Sent'], [allMail, '\\All']] as const) {
      const declared = path && list.find(f => f.path === path)?.specialUse;
      if (declared && declared !== role) throw new Error(`${path} is ${declared}, not ${role}. Nothing was changed.`);
    }
    if (gmail && !allMail) throw new Error('Gmail All Mail not identified; cannot verify message identity. Nothing was changed.');
    return { drafts, sent, allMail, gmail };
  }
  private async load(client: ImapFlow, mailbox: string, uid: number): Promise<MailboxCopy | null> {
    const uidValidity = currentUidValidity(client);
    const message = await client.fetchOne(uid, { source: true, flags: true, labels: true, emailId: true, threadId: true }, { uid: true });
    if (!message || !message.source) return null;
    const parsed = await simpleParser(message.source, { skipImageLinks: true });
    return {
      mailbox, uid, uidValidity,
      messageId: parsed.messageId ?? null, contentHash: draftHash(message.source),
      // \Recent belongs to the session, so it can change just by reopening the mailbox.
      flags: without([...(message.flags ?? [])], '\\Recent'), labels: message.labels ? [...message.labels] : undefined,
      emailId: message.emailId, threadId: message.threadId,
    };
  }
  /** HEADER search is a substring match, so every hit is re-checked against the exact Message-ID. */
  private async copies(client: ImapFlow, mailbox: string, gmail: boolean, emailId: string | undefined, messageId: string | null) {
    const found = new Map<number, MailboxCopy>();
    const add = async (ids: number[], exact: boolean) => {
      for (const uid of ids) {
        if (found.has(uid)) continue;
        const copy = await this.load(client, mailbox, uid);
        if (copy && !copy.flags.includes('\\Deleted') && (!exact || copy.messageId === messageId)) found.set(uid, copy);
      }
    };
    if (gmail && emailId) await add(await uidsMatching(client, { emailId }), false);
    if (messageId) await add(await uidsMatching(client, { header: { 'message-id': messageId } }), true);
    return [...found.values()];
  }
  private async evidence(client: ImapFlow, boxes: Mailboxes, ref: DraftReference, draft: MailboxCopy): Promise<Evidence> {
    const attempt = await this.journal.get(ref);
    const otherAttempt = attempt ? null : await this.journal.getLogical(ref.accountId, draft.messageId, draft.contentHash);
    const messageId = draft.messageId ?? attempt?.messageId ?? null;
    const sent = await this.inMailbox(client, boxes.sent, () => this.copies(client, boxes.sent, boxes.gmail, draft.emailId, messageId));
    const allMail = boxes.allMail
      ? await this.inMailbox(client, boxes.allMail, () => this.copies(client, boxes.allMail!, boxes.gmail, draft.emailId, messageId))
      : [];
    return { draft, attempt, otherAttempt, locked: await this.journal.isLocked(ref), sent, allMail };
  }
  private reference(account: ImapAccount, draft: MailboxCopy): DraftReference {
    return { accountId: account.id, mailbox: draft.mailbox, uid: draft.uid, uidValidity: draft.uidValidity, messageId: draft.messageId };
  }

  /** Dry run: read-only mailbox sessions and no journal writes. */
  async reconcile(account: ImapAccount, overrides: MailboxOverrides = {}, limit = 100) {
    return this.connected(account, async client => {
      const boxes = await this.resolveMailboxes(client, account, overrides);
      const { total, drafts } = await this.inMailbox(client, boxes.drafts, async () => {
        const ids = await uidsMatching(client, { deleted: false });
        const loaded: MailboxCopy[] = [];
        for (const uid of ids.slice(-limit).reverse()) {
          const copy = await this.load(client, boxes.drafts, uid);
          if (copy) loaded.push(copy);
        }
        return { total: ids.length, drafts: loaded };
      });
      const entries = [];
      const known = new Map<string, Set<number>>();
      for (const draft of drafts) {
        const ref = this.reference(account, draft);
        const evidence = await this.evidence(client, boxes, ref, draft);
        for (const copy of [...evidence.sent, ...evidence.allMail]) {
          // Only the scanned message itself explains Draft status; any other copy still reports it.
          if (copy.flags.includes(DRAFT) && !(boxes.gmail && copy.emailId === draft.emailId)) continue;
          if (!known.has(copy.mailbox)) known.set(copy.mailbox, new Set());
          known.get(copy.mailbox)!.add(copy.uid);
        }
        entries.push({
          draft: ref, contentHash: draft.contentHash, ...classifyDraft(evidence, boxes.gmail),
          attemptState: evidence.attempt?.state ?? null, otherAttemptState: evidence.otherAttempt?.state ?? null,
          cleanupState: evidence.attempt?.statusCleanup?.state ?? null,
          flags: draft.flags, emailId: draft.emailId,
          sent: evidence.sent.map(c => ({ uid: c.uid, emailId: c.emailId, contentHash: c.contentHash, flags: c.flags })),
          allMail: evidence.allMail.map(c => ({ uid: c.uid, emailId: c.emailId, labels: c.labels, flags: c.flags })),
        });
      }
      // Draft status outside the scanned drafts is reported but has no cleanup path.
      const draftStatusElsewhere = [];
      for (const mailbox of [boxes.sent, boxes.allMail]) {
        if (!mailbox) continue;
        const ids = await this.inMailbox(client, mailbox, () => uidsMatching(client, { draft: true, deleted: false }));
        const unexplained = ids.filter(uid => !known.get(mailbox)?.has(uid));
        if (unexplained.length) draftStatusElsewhere.push({ mailbox, uids: unexplained.slice(0, 100), total: unexplained.length });
      }
      const counts: Record<string, number> = {};
      for (const entry of entries) counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
      return { dryRun: true, mailboxes: boxes, total, scanned: entries.length, truncated: total > entries.length, counts, entries, draftStatusElsewhere };
    });
  }

  /**
   * Clears Draft status from one eligible message. A journaled pre-write record
   * means a store happens at most once; repeat calls can only re-read.
   * With no send attempt nothing can be stored, so the send lock stays free.
   */
  async clearStatus(account: ImapAccount, ref: DraftReference, contentHash: string, overrides: MailboxOverrides = {}) {
    if (account.id !== ref.accountId) throw new Error('Draft accountId does not match selected account');
    if (!await this.journal.get(ref)) return this.connected(account, client => this.clearInSession(client, account, ref, contentHash, overrides, false));
    return this.journal.exclusive(ref, () => this.connected(account, client => this.clearInSession(client, account, ref, contentHash, overrides, true)));
  }

  private async clearInSession(client: ImapFlow, account: ImapAccount, ref: DraftReference, contentHash: string, overrides: MailboxOverrides, holdsLock: boolean) {
    const boxes = await this.resolveMailboxes(client, account, overrides);
    if (ref.mailbox !== boxes.drafts) throw new Error('Draft reference is not in the Drafts mailbox. Nothing was changed.');
    const attempt = await this.journal.get(ref);
    if (attempt && (attempt.contentHash !== contentHash || (attempt.draft.messageId ?? null) !== ref.messageId)) throw new Error('Reference or contentHash does not match the journaled send. Nothing was changed.');
    if (attempt?.statusCleanup) return this.reread(client, boxes, attempt);

    const draft = await this.inMailbox(client, boxes.drafts, async () => {
      if (currentUidValidity(client) !== ref.uidValidity) throw new Error('Draft UIDVALIDITY changed; run reconciliation again. Nothing was changed.');
      return this.load(client, boxes.drafts, ref.uid);
    });
    if (!draft) {
      if (attempt && boxes.gmail && await this.labelAlreadyGone(client, boxes, attempt)) return { success: true, changed: false, alreadyClean: true, message: 'Sent copy is intact and no Draft label remains; nothing to do.' };
      return { success: false, changed: false, classification: 'uncertain' as const, message: 'Draft reference not found, and no cleanup is recorded. Run reconciliation again.' };
    }
    if (draft.contentHash !== contentHash || draft.messageId !== ref.messageId) throw new Error('Draft changed since reconciliation; run it again. Nothing was changed.');
    const evidence = await this.evidence(client, boxes, ref, draft);
    // This call holds the lock itself, so only the journal and mailboxes decide here.
    const decision = classifyDraft({ ...evidence, locked: holdsLock ? false : evidence.locked }, boxes.gmail);
    if (decision.classification === 'retired') return { success: true, changed: false, alreadyClean: true, classification: decision.classification, message: decision.reason };
    if (!decision.eligible || !evidence.attempt || !holdsLock) return { success: false, changed: false, ...decision };

    const sent = boxes.gmail ? evidence.sent.find(c => c.emailId === draft.emailId)! : evidence.sent[0];
    const before = boxes.gmail ? evidence.allMail.find(c => c.emailId === draft.emailId)! : draft;
    const pending: StatusCleanup = { state: 'started', operation: boxes.gmail ? 'gmail-label' : 'imap-flag', startedAt: new Date().toISOString(), before, sent };
    return this.store(client, boxes, evidence.attempt, pending);
  }

  /** Never stores. A verified cleanup tolerates later unrelated changes; promotion to verified does not. */
  private async reread(client: ImapFlow, boxes: Mailboxes, attempt: SendAttempt) {
    const prior = attempt.statusCleanup!;
    const verified = prior.state === 'verified';
    const problems = await this.readback(client, boxes, prior, verified);
    if (problems.length) {
      return { success: false, changed: false, blocked: true, cleanup: prior, problems, message: verified
        ? 'Cleanup was verified earlier, but the mailbox no longer matches. Re-read only; no store was repeated.'
        : 'Earlier cleanup is not verified. Re-read only; no store was repeated.' };
    }
    if (!verified) {
      attempt.statusCleanup = { ...prior, state: 'verified', finishedAt: new Date().toISOString() };
      await this.journal.record(attempt);
    }
    return { success: true, changed: false, alreadyClean: true, cleanup: attempt.statusCleanup };
  }

  /** Gmail draft UID gone with no recorded cleanup: true only if the journaled message is intact without the label. */
  private async labelAlreadyGone(client: ImapFlow, boxes: Mailboxes, attempt: SendAttempt) {
    const sent = await this.inMailbox(client, boxes.sent, () => this.copies(client, boxes.sent, true, undefined, attempt.messageId));
    if (sent.length !== 1 || sent[0].contentHash !== attempt.contentHash || !sent[0].emailId) return false;
    const all = await this.inMailbox(client, boxes.allMail!, () => this.copies(client, boxes.allMail!, true, sent[0].emailId, null));
    if (all.length !== 1 || all[0].labels === undefined || all[0].labels.includes(DRAFT) || !all[0].labels.includes('\\Sent')) return false;
    const listed = await this.inMailbox(client, boxes.drafts, () => uidsMatching(client, { emailId: sent[0].emailId }));
    return listed.length === 0;
  }

  private async store(client: ImapFlow, boxes: Mailboxes, attempt: SendAttempt, pending: StatusCleanup) {
    const { before } = pending;
    const unknown = 'Store was not acknowledged; its outcome is unknown.';
    const stale = await this.inMailbox(client, before.mailbox, async () => {
      if (currentUidValidity(client) !== before.uidValidity) return 'UIDVALIDITY changed';
      const current = await this.load(client, before.mailbox, before.uid);
      if (!current || current.contentHash !== before.contentHash || current.emailId !== before.emailId) return 'message changed';
      if (!sameSet(current.flags, before.flags) || (boxes.gmail && !sameSet(current.labels, before.labels))) return 'flags or labels changed';
      // Durable before the write: after this, a crash can only lead to a re-read.
      attempt.statusCleanup = pending;
      await this.journal.record(attempt);
      try {
        // imapflow returns false for any command error, including a lost connection.
        const stored = await client.messageFlagsRemove(before.uid, [DRAFT], boxes.gmail ? { uid: true, useLabels: true } : { uid: true });
        if (!stored) attempt.statusCleanup = { ...pending, state: 'uncertain', reason: unknown };
      } catch {
        attempt.statusCleanup = { ...pending, state: 'uncertain', reason: unknown };
      }
      return null;
    }, false);
    if (stale) return { success: false, changed: false, classification: 'uncertain' as const, message: `Not stored: ${stale}. Run reconciliation again.` };

    const problems = await this.readback(client, boxes, pending).catch(() => ['Readback failed.']);
    const stored = attempt.statusCleanup!;
    const verified = !problems.length;
    attempt.statusCleanup = verified
      ? { ...pending, state: 'verified', finishedAt: new Date().toISOString() }
      : { ...stored, state: 'uncertain', reason: stored.reason ?? 'Readback did not match.', problems, finishedAt: new Date().toISOString() };
    // Without a verified readback the mailbox may or may not have changed: changed is null.
    const outcome = verified
      ? { success: true, changed: true, ...(boxes.gmail ? {} : { remainsInMailbox: before.mailbox }) }
      : { success: false, changed: null, blocked: true, problems, message: 'Outcome not verified. Held; no retry.' };
    try { await this.journal.record(attempt); }
    catch { return { ...outcome, cleanup: attempt.statusCleanup, warning: 'Final journal record could not be saved; the pre-write record still blocks a repeat store.' }; }
    return { ...outcome, cleanup: attempt.statusCleanup };
  }

  /**
   * Empty result means only Draft status changed. Reads only, so it is safe to repeat.
   * `tolerant` allows later unrelated flag or label changes but not Draft status.
   */
  private async readback(client: ImapFlow, boxes: Mailboxes, cleanup: StatusCleanup, tolerant = false): Promise<string[]> {
    const { before, sent, operation } = cleanup;
    const problems: string[] = [];
    await this.inMailbox(client, before.mailbox, async () => {
      if (currentUidValidity(client) !== before.uidValidity) { problems.push(`${before.mailbox}: UIDVALIDITY changed`); return; }
      const after = await this.load(client, before.mailbox, before.uid);
      if (!after) { problems.push(`${before.mailbox}: message missing`); return; }
      if (after.contentHash !== before.contentHash) problems.push(`${before.mailbox}: content changed`);
      if (after.emailId !== before.emailId) problems.push(`${before.mailbox}: message ID changed`);
      if (after.threadId !== before.threadId) problems.push(`${before.mailbox}: thread ID changed`);
      const gmailLabels = operation === 'gmail-label';
      if (tolerant) {
        if (after.flags.includes(DRAFT) || (gmailLabels && after.labels?.includes(DRAFT))) problems.push(`${before.mailbox}: Draft status is back`);
      } else {
        if (!sameSet(after.flags, without(before.flags, DRAFT))) problems.push(`${before.mailbox}: flags differ from expected`);
        if (gmailLabels && !sameSet(after.labels, without(before.labels, DRAFT))) problems.push(`${before.mailbox}: labels differ from expected`);
      }
    });
    await this.inMailbox(client, sent.mailbox, async () => {
      if (currentUidValidity(client) !== sent.uidValidity) { problems.push(`${sent.mailbox}: UIDVALIDITY changed`); return; }
      const after = await this.load(client, sent.mailbox, sent.uid);
      if (!after || after.flags.includes('\\Deleted')) { problems.push(`${sent.mailbox}: Sent copy missing`); return; }
      if (after.contentHash !== sent.contentHash) problems.push(`${sent.mailbox}: Sent content changed`);
      if (after.emailId !== sent.emailId) problems.push(`${sent.mailbox}: Sent message ID changed`);
    });
    if (operation === 'gmail-label') {
      const stillDraft = await this.inMailbox(client, boxes.drafts, () => uidsMatching(client, { emailId: before.emailId }));
      if (stillDraft.length) problems.push(`${boxes.drafts}: message is still listed`);
    }
    return problems;
  }
}

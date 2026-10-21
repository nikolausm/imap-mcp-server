import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'node:crypto';
import type { ImapAccount } from '../types/index.js';
import { SmtpService } from './smtp-service.js';
import { ImapService } from './imap-service.js';
import { DraftJournal, draftIdentity, type DraftReference, type SendAttempt } from './draft-state.js';
import { assertCredentialsResolved } from '../utils/env-credentials.js';
import { resolveFrom } from '../utils/send-as.js';
import { draftHeaders } from '../utils/draft-headers.js';

export interface DraftPatch {
  subject?: string; text?: string; html?: string;
  to?: string[]; cc?: string[]; bcc?: string[];
}

/** Rewrite only transport headers; MIME body bytes (including binaries) stay untouched. */
export function transportMessage(raw: Buffer, messageId: string, keepBcc = false): Buffer {
  const { split, headers } = draftHeaders(raw);
  if (headers.some(h => /^resent-/i.test(h))) throw new Error('Resent-* drafts are unsupported; review and save a fresh draft.');
  if (headers.filter(h => /^message-id:/i.test(h)).length > 1 || headers.filter(h => /^from:/i.test(h)).length !== 1) throw new Error('Draft has ambiguous From or Message-ID headers');
  const kept = headers.filter(h => keepBcc || !/^bcc:/i.test(h));
  if (!headers.some(h => /^message-id:/i.test(h))) kept.push(`Message-ID: ${messageId}`);
  return Buffer.concat([Buffer.from(kept.join('\r\n') + '\r\n\r\n', 'latin1'), raw.subarray(split + 4)]);
}

export class DraftService {
  constructor(
    private smtp: SmtpService,
    private imap: ImapService,
    readonly journal = new DraftJournal(),
    private clientFactory = (account: ImapAccount) => new ImapFlow({
      host: account.host, port: account.port, secure: account.tls,
      tls: { host: account.host },
      ...(account.allowStartTLS === false ? { doSTARTTLS: false } : {}),
      auth: { user: account.user, pass: account.password, loginMethod: account.loginMethod }, logger: false,
    }),
  ) {}

  // Dedicated connection: legacy pooled operations can SELECT without acquiring locks.
  private async session<T>(account: ImapAccount, mailbox: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    assertCredentialsResolved(account, 'imap');
    const client = this.clientFactory(account);
    client.on('error', () => {}); // never log raw server errors or message content
    try {
      await client.connect();
      const lock = await client.getMailboxLock(mailbox);
      try { return await fn(client); } finally { lock.release(); }
    } finally { try { await client.logout(); } catch { client.close(); } }
  }
  private checkAccount(account: ImapAccount, ref: DraftReference) {
    if (account.id !== ref.accountId) throw new Error('Draft accountId does not match selected account');
  }
  private async snapshot(client: ImapFlow, ref: DraftReference, expectedHash?: string) {
    if (!client.mailbox || String(client.mailbox.uidValidity) !== ref.uidValidity) throw new Error('Draft UIDVALIDITY changed; list drafts again');
    const message = await client.fetchOne(ref.uid, { source: true, flags: true }, { uid: true });
    if (!message || !message.source || !message.flags?.has('\\Draft') || message.flags.has('\\Deleted')) throw new Error('Draft is missing or no longer active');
    // Mutating operations must reject ambiguous headers before mailparser sees them.
    if (expectedHash !== undefined) draftHeaders(message.source);
    const result = await draftIdentity(ref.accountId, ref.mailbox, ref.uid, ref.uidValidity, message.source);
    if (result.draft.messageId !== ref.messageId) throw new Error('Draft Message-ID changed');
    if (expectedHash && result.contentHash !== expectedHash) throw new Error('Draft content changed; read and review it again');
    return { ...result, raw: message.source };
  }
  async list(account: ImapAccount, mailbox: string, limit = 50) {
    return this.session(account, mailbox, async client => {
      const ids = await client.search({ draft: true, deleted: false }, { uid: true });
      const results = [];
      for (const uid of (ids || []).slice(-limit).reverse()) {
        const message = await client.fetchOne(uid, { source: true, flags: true }, { uid: true });
        if (!message || !message.source || !message.flags?.has('\\Draft') || message.flags.has('\\Deleted')) continue;
        const parsed = await simpleParser(message.source);
        results.push({ ...await draftIdentity(account.id, mailbox, uid, String(client.mailbox && client.mailbox.uidValidity), message.source), subject: parsed.subject ?? '', to: parsed.to, date: parsed.date });
      }
      return { drafts: results, total: (ids || []).length, limit };
    });
  }
  async read(account: ImapAccount, ref: DraftReference) {
    this.checkAccount(account, ref);
    return this.session(account, ref.mailbox, async client => {
      const saved = await this.snapshot(client, ref);
      const parsed = await simpleParser(saved.raw, { skipImageLinks: true });
      return { draft: saved.draft, contentHash: saved.contentHash, rawMimeBase64: saved.raw.toString('base64'), subject: parsed.subject, from: parsed.from, to: parsed.to, cc: parsed.cc, bcc: parsed.bcc, text: parsed.text, html: parsed.html, inReplyTo: parsed.inReplyTo, references: parsed.references, attachments: parsed.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, cid: a.cid, size: a.size })), attempt: await this.journal.get(ref) };
    });
  }
  async update(account: ImapAccount, ref: DraftReference, hash: string, patch: DraftPatch) {
    this.checkAccount(account, ref);
    return this.journal.exclusive(ref, async () => {
      if (await this.journal.get(ref)) throw new Error('Draft has a send attempt; reconcile it before editing');
      return this.session(account, ref.mailbox, async client => {
        const saved = await this.snapshot(client, ref, hash);
        // Preserve every untouched header and MIME part. Editing bodies rebuilds MIME
        // with decoded attachments, preserving content, disposition and Content-ID.
        const raw = await this.smtp.patchDraft(saved.raw, patch);
        await this.snapshot(client, ref, hash);
        const appended = await client.append(ref.mailbox, raw, ['\\Draft', '\\Seen']);
        if (!appended) throw new Error('Draft replacement APPEND failed; original retained');
        if (!appended.uid || !appended.uidValidity) return { success: true, replacementUnresolved: true, originalRetained: true, message: 'APPEND completed without UIDPLUS identity. List and review drafts; do not blindly repeat the update.' };
        const replacement = await draftIdentity(account.id, ref.mailbox, appended.uid, String(appended.uidValidity), raw);
        try {
          if (String(appended.uidValidity) !== ref.uidValidity) throw new Error('Mailbox generation changed during replacement');
          await this.snapshot(client, ref, hash);
          if (!await client.messageFlagsRemove(ref.uid, ['\\Draft'], { uid: true })) throw new Error('Flag change failed');
          return { success: true, ...replacement, originalRetained: true, originalActive: false };
        } catch {
          return { success: true, ...replacement, originalRetained: true, originalActive: true, warning: 'Replacement saved but original could not be retired; review both. Do not repeat update.' };
        }
      });
    });
  }
  async send(account: ImapAccount, ref: DraftReference, hash: string) {
    this.checkAccount(account, ref);
    return this.journal.exclusive(ref, async () => {
      const previous = await this.journal.get(ref);
      if (previous) return { success: false, blocked: true, attempt: previous, message: 'An attempt already exists. Reconcile delivery; never blindly retry.' };
      return this.session(account, ref.mailbox, async client => {
        const saved = await this.snapshot(client, ref, hash);
        const parsed = await simpleParser(saved.raw, { skipImageLinks: true });
        if (parsed.from?.value.length !== 1 || !parsed.from.value[0].address) throw new Error('Draft must contain exactly one From mailbox');
        resolveFrom(account, parsed.from.value[0].address);
        const addresses = (value: typeof parsed.to) => (Array.isArray(value) ? value : value ? [value] : []).flatMap(v => v.value).map(v => v.address).filter((v): v is string => !!v);
        const recipients = [...new Set([...addresses(parsed.to), ...addresses(parsed.cc), ...addresses(parsed.bcc)])];
        if (!recipients.length) throw new Error('Draft has no recipients');
        const messageId = parsed.messageId || `<${randomUUID()}@imap-mcp.local>`;
        if (!/^<[^\s<>]+@[^\s<>]+>$/.test(messageId)) throw new Error('Invalid draft Message-ID');
        const wire = transportMessage(saved.raw, messageId);
        const attempt: SendAttempt = { draft: ref, contentHash: hash, messageId, startedAt: new Date().toISOString(), state: 'prepared' };
        // Persist before any SMTP interaction, even transporter verification.
        const duplicate = await this.journal.claim(attempt);
        if (duplicate) return { success: false, blocked: true, attempt: duplicate, message: 'This Message-ID or identical draft content already has an attempt, possibly under a different UID. Reconcile the original attempt; no SMTP retry.' };
        let smtpStarted = false;
        try {
          await this.snapshot(client, ref, hash);
          const transporter = await this.smtp.createTransporter(account);
          await this.snapshot(client, ref, hash);
          smtpStarted = true;
          const info = await transporter.sendMail({ envelope: { from: parsed.from.value[0].address, to: recipients }, raw: wire });
          // A partial acceptance is not safe to retry for the full envelope.
          const mailboxAddress = (v: string | { address: string }) => typeof v === 'string' ? v : v.address;
          attempt.acceptedRecipients = (info.accepted ?? []).map(mailboxAddress);
          attempt.rejectedRecipients = (info.rejected ?? []).map(mailboxAddress);
          const accepted = new Set(attempt.acceptedRecipients!.map(v => v.toLowerCase()));
          attempt.state = info.rejected?.length || recipients.some(r => !accepted.has(r.toLowerCase())) ? 'partial' : 'confirmed';
          attempt.cleanup = 'pending';
          await this.journal.record(attempt);
        } catch {
          // Includes failures recording SMTP acceptance: durable prepared state is
          // equally retry-blocking if the filesystem itself is unavailable.
          attempt.state = smtpStarted ? 'uncertain' : 'failed';
          try { await this.journal.record(attempt); } catch { /* retain durable claim */ }
          return { success: false, attempt, message: smtpStarted ? 'Delivery is uncertain. Reconcile using Message-ID and provider logs; no retry was performed.' : 'Submission did not start. Attempt retained for review; no automatic retry.' };
        }
        if (attempt.state !== 'confirmed') return { success: false, attempt, message: 'SMTP did not confirm all recipients. Draft retained; reconcile per-recipient delivery before any manual resend.' };
        // Post-send errors must never become SMTP retry instructions.
        try {
          await this.snapshot(client, ref, hash);
          if (!await client.messageFlagsRemove(ref.uid, ['\\Draft'], { uid: true })) throw new Error('Flag change failed');
          attempt.cleanup = 'marked';
        } catch { /* retain exact draft; send journal prevents resubmission */ }
        if (account.saveToSent !== false) {
          try { attempt.sentCopy = await this.imap.appendToSentFolder(account.id, transportMessage(saved.raw, messageId, true), account.sentFolder); }
          catch { attempt.sentCopy = { saved: false, error: 'Sent copy failed; do not resend' }; }
        }
        try { await this.journal.record(attempt); }
        catch { return { success: true, attempt, warning: 'SMTP confirmed; final journal metadata could not be saved. Do not resend.' }; }
        return { success: true, attempt };
      });
    });
  }
}

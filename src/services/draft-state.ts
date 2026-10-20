import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { simpleParser } from 'mailparser';

export interface DraftReference {
  accountId: string;
  mailbox: string;
  uid: number;
  uidValidity: string;
  messageId: string | null;
}
export const draftHash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
export async function draftIdentity(accountId: string, mailbox: string, uid: number, uidValidity: string, raw: Buffer) {
  const parsed = await simpleParser(raw);
  return { draft: { accountId, mailbox, uid, uidValidity, messageId: parsed.messageId ?? null }, contentHash: draftHash(raw) };
}
export interface SendAttempt {
  draft: DraftReference;
  contentHash: string;
  messageId: string;
  startedAt: string;
  state: 'prepared' | 'failed' | 'uncertain' | 'confirmed' | 'partial';
  acceptedRecipients?: string[];
  rejectedRecipients?: string[];
  cleanup?: 'marked' | 'pending';
  sentCopy?: unknown;
}

/** Metadata only. Exclusive durable claims survive crashes; no automatic retry or expiry. */
export class DraftJournal {
  constructor(readonly directory = join(homedir(), '.imap-mcp', 'draft-attempts')) {}
  private key(ref: DraftReference) {
    return createHash('sha256').update(JSON.stringify([ref.accountId, ref.mailbox, ref.uidValidity, ref.uid])).digest('hex');
  }
  private path(ref: DraftReference) { return join(this.directory, this.key(ref) + '.json'); }
  private async syncDirectory(path = this.directory) {
    const dir = await open(path, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  private async ensureDirectory() {
    const firstCreated = await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (firstCreated) {
      // Persist directory entries too, including the first journal creation.
      const stop = dirname(firstCreated);
      for (let path = this.directory; ; path = dirname(path)) {
        await this.syncDirectory(path);
        if (path === stop) break;
      }
    }
  }
  async get(ref: DraftReference): Promise<SendAttempt | null> {
    try { return JSON.parse(await readFile(this.path(ref), 'utf8')); }
    catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async claim(attempt: SendAttempt) {
    await this.ensureDirectory();
    const file = await open(this.path(attempt.draft), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(attempt)); await file.sync(); }
    finally { await file.close(); }
    await this.syncDirectory();
    // Also guard copies/moves with a different UID. Reused Message-IDs fail
    // closed; drafts without IDs fall back to the reviewed source hash.
    const logicalKey = createHash('sha256').update(JSON.stringify([
      attempt.draft.accountId, attempt.draft.messageId || attempt.contentHash,
    ])).digest('hex');
    const logicalPath = join(this.directory, logicalKey + '.message');
    let logical;
    try { logical = await open(logicalPath, 'wx', 0o600); }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      const original: SendAttempt = JSON.parse(await readFile(logicalPath, 'utf8'));
      return await this.get(original.draft) ?? original;
    }
    try { await logical.writeFile(JSON.stringify(attempt)); await logical.sync(); }
    finally { await logical.close(); }
    await this.syncDirectory();
    return null;
  }
  async record(attempt: SendAttempt) {
    const tmp = this.path(attempt.draft) + '.' + randomUUID();
    const file = await open(tmp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(attempt)); await file.sync(); }
    finally { await file.close(); }
    await rename(tmp, this.path(attempt.draft));
    await this.syncDirectory();
  }
  async exclusive<T>(ref: DraftReference, operation: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lockPath = join(this.directory, this.key(ref) + '.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (e: any) {
      if (e.code === 'EEXIST') throw new Error('Draft operation already active or interrupted; reconcile the local lock before proceeding.');
      throw e;
    }
    try { return await operation(); }
    finally {
      // Cleanup failure must not conceal a confirmed send result. A retained
      // lock fails closed on subsequent calls and requires operator recovery.
      try { await lock.close(); await unlink(lockPath); } catch { /* stale lock */ }
    }
  }
}

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, Folder, SearchCriteria } from '../types/index.js';
import type { AccountManager } from './account-manager.js';

interface ConnectionState {
  client: ImapFlow;
  account: ImapAccount;
  isConnected: boolean;
}

interface EmailContentOptions {
  includeAttachmentText?: boolean;
  maxAttachmentTextBytes?: number;
  maxAttachmentTextChars?: number;
}

export class ImapService {
  private connections: Map<string, ConnectionState> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 3;
  private accountManager?: AccountManager;

  setAccountManager(accountManager: AccountManager): void {
    this.accountManager = accountManager;
  }

  async connect(account: ImapAccount): Promise<void> {
    const existing = this.connections.get(account.id);
    if (existing?.isConnected) {
      return;
    }

    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.tls,
      auth: {
        user: account.user,
        pass: account.password,
        loginMethod: account.loginMethod,
      },
      logger: false,
    });

    // Set up event handlers for connection management
    client.on('error', (err) => {
      console.error(`IMAP error for account ${account.id}:`, err.message);
      const state = this.connections.get(account.id);
      if (state) {
        state.isConnected = false;
      }
    });

    client.on('close', () => {
      const state = this.connections.get(account.id);
      if (state) {
        state.isConnected = false;
      }
    });

    await client.connect();

    this.connections.set(account.id, {
      client,
      account,
      isConnected: true,
    });
    this.reconnectAttempts.set(account.id, 0);
  }

  async disconnect(accountId: string): Promise<void> {
    const state = this.connections.get(accountId);
    if (state) {
      try {
        await state.client.logout();
      } catch {
        // Ignore logout errors
      }
      this.connections.delete(accountId);
      this.reconnectAttempts.delete(accountId);
    }
  }

  private async ensureConnected(accountId: string): Promise<ImapFlow> {
    let state = this.connections.get(accountId);
    if (!state) {
      // Auto-connect using stored account credentials
      if (this.accountManager) {
        const account = this.accountManager.getAccount(accountId);
        if (account) {
          await this.connect(account);
          state = this.connections.get(accountId);
        }
      }
      if (!state) {
        throw new Error(`No connection configured for account ${accountId}`);
      }
    }

    if (!state.isConnected || !state.client.usable) {
      // Try to reconnect
      const attempts = this.reconnectAttempts.get(accountId) || 0;
      if (attempts >= this.maxReconnectAttempts) {
        throw new Error(`Failed to reconnect to account ${accountId} after ${this.maxReconnectAttempts} attempts`);
      }

      this.reconnectAttempts.set(accountId, attempts + 1);
      console.log(`Reconnecting to account ${accountId} (attempt ${attempts + 1})`);

      try {
        await state.client.connect();
        state.isConnected = true;
        this.reconnectAttempts.set(accountId, 0);
      } catch (err) {
        state.isConnected = false;
        throw new Error(`Failed to reconnect: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return state.client;
  }

  async listFolders(accountId: string): Promise<Folder[]> {
    const client = await this.ensureConnected(accountId);
    const folders: Folder[] = [];

    const list = await client.list();
    for (const folder of list) {
      folders.push({
        name: folder.path,
        delimiter: folder.delimiter,
        attributes: folder.flags || [],
        children: folder.folders ? this.convertFolderList(folder.folders) : undefined,
      });
    }

    return folders;
  }

  private convertFolderList(folders: any[]): Folder[] {
    return folders.map(f => ({
      name: f.path,
      delimiter: f.delimiter,
      attributes: f.flags || [],
      children: f.folders ? this.convertFolderList(f.folders) : undefined,
    }));
  }

  async selectFolder(accountId: string, folderName: string): Promise<any> {
    const client = await this.ensureConnected(accountId);
    return await client.mailboxOpen(folderName);
  }

  async searchEmails(accountId: string, folderName: string, criteria: SearchCriteria): Promise<EmailMessage[]> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const searchQuery = this.buildSearchQuery(criteria);
      const uids = await client.search(searchQuery, { uid: true });

      if (uids.length === 0) {
        return [];
      }

      const messages: EmailMessage[] = [];

      for await (const msg of client.fetch(uids, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true })) {
        messages.push({
          uid: msg.uid,
          date: msg.internalDate || msg.envelope?.date || new Date(),
          from: msg.envelope?.from?.[0] ? this.formatAddress(msg.envelope.from[0]) : '',
          to: msg.envelope?.to?.map((addr: any) => this.formatAddress(addr)) || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          flags: Array.from(msg.flags || []),
        });
      }

      return messages;
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async getLatestEmails(accountId: string, folderName: string, count: number): Promise<EmailMessage[]> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const uids = await client.search({ all: true }, { uid: true });
      if (uids.length === 0) {
        return [];
      }

      const latestUids = [...uids].sort((a, b) => a - b).slice(-count);
      const messages: EmailMessage[] = [];

      for await (const msg of client.fetch(latestUids, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true })) {
        messages.push({
          uid: msg.uid,
          date: msg.internalDate || msg.envelope?.date || new Date(),
          from: msg.envelope?.from?.[0] ? this.formatAddress(msg.envelope.from[0]) : '',
          to: msg.envelope?.to?.map((addr: any) => this.formatAddress(addr)) || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          flags: Array.from(msg.flags || []),
        });
      }

      return messages.sort((a, b) => b.date.getTime() - a.date.getTime());
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  private formatAddress(addr: any): string {
    if (!addr) return '';
    if (addr.name) {
      return `${addr.name} <${addr.address}>`;
    }
    return addr.address || '';
  }

  async getEmailContent(
    accountId: string,
    folderName: string,
    uid: number,
    options: EmailContentOptions = {}
  ): Promise<EmailContent> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const source = await client.fetchOne(uid, { source: true, flags: true }, { uid: true });

      if (!source || !source.source) {
        throw new Error(`Email with UID ${uid} not found`);
      }

      const parsed = await simpleParser(source.source);
      const {
        includeAttachmentText = false,
        maxAttachmentTextBytes = 256 * 1024,
        maxAttachmentTextChars = 100000,
      } = options;
      const textAttachmentExtensions = ['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.xml', '.yml', '.yaml'];
      const pdfExtensions = ['.pdf'];

      // Extract all raw headers as key-value pairs
      const headers: Record<string, string | string[]> = {};
      if (parsed.headers) {
        const headerToString = (v: unknown): string => {
          if (typeof v === 'string') return v;
          if (v instanceof Date) return v.toISOString();
          if (v && typeof v === 'object' && 'text' in v) return String((v as { text: string }).text);
          if (v && typeof v === 'object' && 'value' in v) return String((v as { value: string }).value);
          if (v && typeof v === 'object') return JSON.stringify(v);
          return String(v);
        };

        for (const [key, value] of parsed.headers) {
          if (typeof value === 'string') {
            headers[key] = value;
          } else if (Array.isArray(value)) {
            headers[key] = value.map(headerToString);
          } else {
            headers[key] = headerToString(value);
          }
        }
      }

      return {
        uid,
        date: parsed.date || new Date(),
        from: parsed.from?.text || '',
        to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text || '') : [parsed.to.text || '']) : [],
        subject: parsed.subject || '',
        messageId: parsed.messageId || '',
        inReplyTo: parsed.inReplyTo as string | undefined,
        flags: Array.from(source.flags || []),
        headers,
        textContent: parsed.text,
        htmlContent: parsed.html || undefined,
        attachments: await Promise.all((parsed.attachments || []).map(async (att: any) => {
          const filename = att.filename || 'unknown';
          const contentType = att.contentType || 'application/octet-stream';
          const size = att.size || 0;
          const attachment = {
            filename,
            contentType,
            size,
            contentId: att.contentId,
          };

          if (!includeAttachmentText || !att?.content) {
            return attachment;
          }

          const contentTypeLower = String(contentType).toLowerCase();
          const filenameLower = String(filename).toLowerCase();
          const isTextContentType =
            contentTypeLower.startsWith('text/') ||
            ['application/json', 'application/xml', 'application/xhtml+xml', 'application/yaml', 'application/x-yaml'].includes(contentTypeLower);
          const hasTextExtension = textAttachmentExtensions.some(ext => filenameLower.endsWith(ext));
          const isTextAttachment = isTextContentType || hasTextExtension;

          // Check if this is a PDF
          const isPdf = contentTypeLower === 'application/pdf' || pdfExtensions.some(ext => filenameLower.endsWith(ext));

          if (isPdf && att?.content) {
            try {
              const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
              const contentBuffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
              const pdfData = await pdfParse(contentBuffer);
              const rawText = pdfData.text;
              const textTruncated = rawText.length > maxAttachmentTextChars;
              const textContent = textTruncated ? rawText.slice(0, maxAttachmentTextChars) : rawText;

              return {
                ...attachment,
                textContent,
                textContentTruncated: textTruncated || undefined,
              };
            } catch {
              // PDF parsing failed, return without text
              return attachment;
            }
          }

          if (!isTextAttachment) {
            return attachment;
          }

          const contentBuffer = Buffer.isBuffer(att.content) ? att.content : undefined;
          const contentLength = contentBuffer?.length ?? (typeof att.content === 'string' ? att.content.length : 0);
          if (contentLength > maxAttachmentTextBytes) {
            return attachment;
          }

          const rawText = contentBuffer ? contentBuffer.toString('utf8') : String(att.content);
          const textTruncated = rawText.length > maxAttachmentTextChars;
          const textContent = textTruncated ? rawText.slice(0, maxAttachmentTextChars) : rawText;

          return {
            ...attachment,
            textContent,
            textContentTruncated: textTruncated || undefined,
          };
        })),
      };
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async getAttachmentContent(
    accountId: string,
    folderName: string,
    uid: number,
    filename: string
  ): Promise<{ content: Buffer; contentType: string; filename: string }> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const source = await client.fetchOne(uid, { source: true }, { uid: true });

      if (!source || !source.source) {
        throw new Error(`Email with UID ${uid} not found`);
      }

      const parsed = await simpleParser(source.source);
      const attachment = parsed.attachments?.find(
        (att: any) => att.filename === filename || att.contentId === filename
      );

      if (!attachment) {
        throw new Error(`Attachment "${filename}" not found in email UID ${uid}`);
      }

      return {
        content: attachment.content,
        contentType: attachment.contentType || 'application/octet-stream',
        filename: attachment.filename || 'unknown',
      };
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async markAsRead(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async markAsUnread(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);
    const connState = this.connections.get(accountId);
    const isGmail = connState?.account?.host?.includes('gmail') || connState?.account?.host?.includes('google');
    const trashFolder = isGmail ? '[Gmail]/Trash' : 'Trash';

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      if (folderName === trashFolder) {
        // Already in Trash, permanently delete
        await client.messageDelete(uid, { uid: true });
      } else {
        // Move to Trash instead of permanent expunge
        await client.messageMove(uid, trashFolder, { uid: true });
      }
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async bulkDelete(
    accountId: string,
    folderName: string,
    uids: number[],
    chunkSize: number = 50,
    onProgress?: (deleted: number, total: number) => void
  ): Promise<{ deleted: number; failed: number; errors: string[] }> {
    const client = await this.ensureConnected(accountId);
    const connState = this.connections.get(accountId);
    const isGmail = connState?.account?.host?.includes('gmail') || connState?.account?.host?.includes('google');
    const trashFolder = isGmail ? '[Gmail]/Trash' : 'Trash';
    const isAlreadyInTrash = folderName === trashFolder;

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process in chunks to avoid connection issues
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);

      let lock;
      try {
        // Ensure we're still connected before each chunk
        await this.ensureConnected(accountId);

        lock = await client.getMailboxLock(folderName);

        // Use sequence set for bulk operations
        const uidSet = chunk.join(',');
        if (isAlreadyInTrash) {
          await client.messageDelete(uidSet, { uid: true });
        } else {
          await client.messageMove(uidSet, trashFolder, { uid: true });
        }

        deleted += chunk.length;

        if (onProgress) {
          onProgress(deleted, uids.length);
        }
      } catch (err) {
        failed += chunk.length;
        errors.push(`Failed to delete UIDs ${chunk[0]}-${chunk[chunk.length - 1]}: ${err instanceof Error ? err.message : 'Unknown error'}`);

        // Try to reconnect for next chunk
        const state = this.connections.get(accountId);
        if (state) {
          state.isConnected = false;
        }
      } finally {
        if (lock) {
          lock.release();
        }
      }
    }

    return { deleted, failed, errors };
  }

  async moveEmail(accountId: string, folderName: string, uid: number, targetFolder: string): Promise<void> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageMove(uid, targetFolder, { uid: true });
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async appendToSentFolder(accountId: string, rawMessage: Buffer | string): Promise<boolean> {
    const client = await this.ensureConnected(accountId);

    // Auto-detect sent folder name
    const folders = await this.listFolders(accountId);
    const sentFolderNames = ['Sent Messages', 'Sent', 'INBOX.Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail'];
    const sentFolder = folders.find(f => sentFolderNames.includes(f.name));

    if (!sentFolder) {
      console.warn(`[IMAP] No sent folder found for account ${accountId}. Tried: ${sentFolderNames.join(', ')}`);
      return false;
    }

    try {
      await client.append(sentFolder.name, rawMessage, ['\\Seen']);
      return true;
    } catch (err) {
      console.error(`[IMAP] Failed to append to ${sentFolder.name}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  async testConnection(account: ImapAccount): Promise<{ success: boolean; folders?: string[]; messageCount?: number; error?: string }> {
    const testClient = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.tls,
      auth: {
        user: account.user,
        pass: account.password,
        loginMethod: account.loginMethod,
      },
      logger: false,
    });

    try {
      await testClient.connect();

      // List folders
      const folderList = await testClient.list();
      const folders = folderList.map(f => f.path);

      // Get INBOX message count
      let messageCount = 0;
      try {
        const inbox = await testClient.status('INBOX', { messages: true });
        messageCount = inbox.messages || 0;
      } catch {
        // INBOX might not exist or have different name
      }

      await testClient.logout();

      return {
        success: true,
        folders,
        messageCount,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  private buildSearchQuery(criteria: SearchCriteria): any {
    const query: any = {};

    if (criteria.from) {
      query.from = criteria.from;
    }
    if (criteria.to) {
      query.to = criteria.to;
    }
    if (criteria.subject) {
      query.subject = criteria.subject;
    }
    if (criteria.body) {
      query.body = criteria.body;
    }
    if (criteria.since) {
      query.since = criteria.since;
    }
    if (criteria.before) {
      query.before = criteria.before;
    }
    if (criteria.seen !== undefined) {
      query.seen = criteria.seen;
    }
    if (criteria.flagged !== undefined) {
      query.flagged = criteria.flagged;
    }
    if (criteria.answered !== undefined) {
      query.answered = criteria.answered;
    }
    if (criteria.draft !== undefined) {
      query.draft = criteria.draft;
    }

    // If no criteria, search all
    if (Object.keys(query).length === 0) {
      return { all: true };
    }

    return query;
  }
}

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, Folder, SearchCriteria } from '../types/index.js';

interface ConnectionState {
  client: ImapFlow;
  account: ImapAccount;
  isConnected: boolean;
}

export class ImapService {
  private connections: Map<string, ConnectionState> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 3;

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
    const state = this.connections.get(accountId);
    if (!state) {
      throw new Error(`No connection configured for account ${accountId}`);
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
      })) {
        messages.push({
          uid: msg.uid,
          date: msg.envelope?.date || new Date(),
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

  private formatAddress(addr: any): string {
    if (!addr) return '';
    if (addr.name) {
      return `${addr.name} <${addr.address}>`;
    }
    return addr.address || '';
  }

  async getEmailContent(accountId: string, folderName: string, uid: number): Promise<EmailContent> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const source = await client.fetchOne(uid, { source: true, flags: true }, { uid: true });

      if (!source || !source.source) {
        throw new Error(`Email with UID ${uid} not found`);
      }

      const parsed = await simpleParser(source.source);

      return {
        uid,
        date: parsed.date || new Date(),
        from: parsed.from?.text || '',
        to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text || '') : [parsed.to.text || '']) : [],
        subject: parsed.subject || '',
        messageId: parsed.messageId || '',
        inReplyTo: parsed.inReplyTo as string | undefined,
        flags: Array.from(source.flags || []),
        textContent: parsed.text,
        htmlContent: parsed.html || undefined,
        attachments: parsed.attachments?.map((att: any) => ({
          filename: att.filename || 'unknown',
          contentType: att.contentType || 'application/octet-stream',
          size: att.size || 0,
          contentId: att.contentId,
        })) || [],
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

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageDelete(uid, { uid: true });
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

        // Use sequence set for bulk delete
        const uidSet = chunk.join(',');
        await client.messageDelete(uidSet, { uid: true });

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

  async testConnection(account: ImapAccount): Promise<{ success: boolean; folders?: string[]; messageCount?: number; error?: string }> {
    const testClient = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.tls,
      auth: {
        user: account.user,
        pass: account.password,
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

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, Folder, SearchCriteria } from '../types/index.js';
import type { AccountManager } from './account-manager.js';

/**
 * Providers that require IMAP access to be manually enabled in account settings.
 * Each entry maps a host pattern to a human-readable hint.
 */
const PROVIDERS_REQUIRING_IMAP_ENABLE: Array<{ pattern: RegExp; name: string; settingsPath: string }> = [
  {
    pattern: /gmx\.(net|de|at|ch|com)/i,
    name: 'GMX',
    settingsPath: 'Settings → Email → POP3 & IMAP → Enable IMAP access',
  },
  {
    pattern: /web\.de/i,
    name: 'WEB.DE',
    settingsPath: 'Settings → Email → POP3 & IMAP → Enable IMAP access',
  },
  {
    pattern: /zoho\.(com|eu)/i,
    name: 'Zoho Mail',
    settingsPath: 'Settings → Mail Accounts → IMAP Access → Enable',
  },
  {
    pattern: /yahoo\.(com|de|co\.uk|fr|es|it)/i,
    name: 'Yahoo Mail',
    settingsPath: 'Account Security settings → Generate app password',
  },
  {
    pattern: /gmail\.com|googlemail\.com/i,
    name: 'Gmail',
    settingsPath: 'Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP',
  },
];

/**
 * Error message patterns that indicate IMAP access is disabled at the provider.
 */
const IMAP_DISABLED_PATTERNS = [
  /imap.*disabled/i,
  /imap.*not.*enabled/i,
  /imap.*access.*denied/i,
  /\[UNAVAILABLE\]/i,
  /\[ALERT\].*imap/i,
  /imap.*not.*activated/i,
  /please.*enable.*imap/i,
  /enable.*imap.*access/i,
  /pop3.*imap.*disabled/i,
];

/**
 * Enriches a connection error with a provider-specific hint when IMAP access
 * may need to be manually enabled in the account settings.
 */
function enrichConnectionError(error: unknown, host: string): string {
  const originalMessage = error instanceof Error ? error.message : 'Connection failed';

  // Check if the error message already indicates IMAP is disabled
  const looksLikeImapDisabled = IMAP_DISABLED_PATTERNS.some(pattern => pattern.test(originalMessage));

  if (!looksLikeImapDisabled) {
    return originalMessage;
  }

  const matchedProvider = PROVIDERS_REQUIRING_IMAP_ENABLE.find(p => p.pattern.test(host));

  if (matchedProvider) {
    return (
      `${originalMessage}\n\n` +
      `Hint: ${matchedProvider.name} requires IMAP access to be manually enabled. ` +
      `Go to: ${matchedProvider.settingsPath}`
    );
  }

  // Generic hint when error looks IMAP-related but provider is unknown
  return (
    `${originalMessage}\n\n` +
    `Hint: Some providers (e.g. GMX, WEB.DE, Zoho) require IMAP access to be manually enabled ` +
    `in the account settings (usually under Settings → Email → POP3 & IMAP).`
  );
}

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

    try {
      await client.connect();
    } catch (err) {
      throw new Error(enrichConnectionError(err, account.host));
    }

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
      // Try to reconnect. ImapFlow instances are single-use: once a client has
      // connected and then closed (e.g. an idle-timeout between two tool calls),
      // calling .connect() on the SAME object throws "Can not re-use ImapFlow
      // instance". So tear the dead client down and build a fresh one via
      // connect(), instead of reusing state.client.
      const attempts = this.reconnectAttempts.get(accountId) || 0;
      if (attempts >= this.maxReconnectAttempts) {
        throw new Error(`Failed to reconnect to account ${accountId} after ${this.maxReconnectAttempts} attempts`);
      }

      this.reconnectAttempts.set(accountId, attempts + 1);
      console.log(`Reconnecting to account ${accountId} (attempt ${attempts + 1})`);

      const account = state.account;
      try {
        // Dispose the unusable instance; the connection is already gone, so
        // ignore any teardown error.
        try {
          await state.client.logout();
        } catch {
          // ignore
        }
        this.connections.delete(accountId);

        // Build a brand-new ImapFlow client + connection state. connect() resets
        // the reconnect-attempt counter to 0 on success.
        await this.connect(account);
        state = this.connections.get(accountId);
        if (!state) {
          throw new Error('connection state missing after reconnect');
        }
      } catch (err) {
        throw new Error(`Failed to reconnect: ${err instanceof Error ? err.message : String(err)}`);
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
        attributes: Array.from(folder.flags || []),
        specialUse: folder.specialUse,
        children: (folder as any).folders ? this.convertFolderList((folder as any).folders) : undefined,
      });
    }

    return folders;
  }

  private convertFolderList(folders: any[]): Folder[] {
    return folders.map(f => ({
      name: f.path,
      delimiter: f.delimiter,
      attributes: Array.from(f.flags || []),
      specialUse: f.specialUse,
      children: f.folders ? this.convertFolderList(f.folders) : undefined,
    }));
  }

  async selectFolder(accountId: string, folderName: string): Promise<any> {
    const client = await this.ensureConnected(accountId);
    return await client.mailboxOpen(folderName);
  }

  async getFolderStatus(accountId: string, folderName: string): Promise<{
    messages: number;
    recent: number;
    unseen: number;
    uidValidity: number;
    uidNext: number;
  }> {
    const client = await this.ensureConnected(accountId);
    const status = await client.status(folderName, {
      messages: true,
      recent: true,
      unseen: true,
      uidNext: true,
      uidValidity: true,
    });
    return {
      messages: Number(status.messages ?? 0),
      recent: Number(status.recent ?? 0),
      unseen: Number(status.unseen ?? 0),
      uidValidity: Number(status.uidValidity ?? 0),
      uidNext: Number(status.uidNext ?? 0),
    };
  }

  async searchEmails(accountId: string, folderName: string, criteria: SearchCriteria): Promise<EmailMessage[]> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const searchQuery = this.buildSearchQuery(criteria);
      const uids = await client.search(searchQuery, { uid: true });

      if (!uids || uids.length === 0) {
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
          date: new Date(msg.internalDate || msg.envelope?.date || Date.now()),
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
      if (!uids || uids.length === 0) {
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
          date: new Date(msg.internalDate || msg.envelope?.date || Date.now()),
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

  /**
   * Detect the trash folder for an IMAP account.
   *
   * Priority:
   *   1. RFC 6154 SPECIAL-USE `\Trash` flag — the server tells us itself
   *   2. Provider-specific hardcoded path (Gmail's `[Gmail]/Trash`)
   *   3. Fallback list of common trash folder names across locales
   *      (Sherweb FR Exchange uses "Éléments supprimés", not "Trash")
   *
   * Without this, a server like Sherweb would silently fail: messageMove
   * to a non-existent `Trash` folder, deleted counter incremented, but
   * messages never actually leave the source folder.
   */
  private async resolveTrashFolder(accountId: string): Promise<string | null> {
    const client = await this.ensureConnected(accountId);
    const connState = this.connections.get(accountId);
    const isGmail = connState?.account?.host?.includes('gmail') || connState?.account?.host?.includes('google');

    // 1. SPECIAL-USE flag (RFC 6154) — most reliable
    try {
      const folders = await client.list();
      const trash = folders.find((f: any) => f.specialUse === '\\Trash');
      if (trash) return trash.path;

      // 2. Gmail path fallback (special-use may be absent)
      if (isGmail && folders.some((f: any) => f.path === '[Gmail]/Trash')) {
        return '[Gmail]/Trash';
      }

      // 3. Common trash folder names across providers/locales
      const candidates = [
        'Trash',
        'Deleted Items',           // Exchange EN
        'Deleted Messages',         // Apple Mail
        'Éléments supprimés',      // Exchange FR (Sherweb)
        'Eléments supprimés',      // Exchange FR no accent on É
        'Elementos eliminados',     // Exchange ES
        'Gelöschte Elemente',       // Exchange DE
        'Elementi eliminati',       // Exchange IT
        'Papierkorb',               // DE classic
        'Papelera',                 // ES classic
        'Corbeille',                // FR classic
        'INBOX.Trash',              // Courier-IMAP
      ];
      for (const name of candidates) {
        if (folders.some((f: any) => f.path === name)) return name;
      }
    } catch {
      // LIST failed — fall through to legacy default
    }

    // 4. Legacy fallback (preserves old behavior, may still fail loudly now)
    return isGmail ? '[Gmail]/Trash' : 'Trash';
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);
    const trashFolder = await this.resolveTrashFolder(accountId);
    if (!trashFolder) {
      throw new Error('Cannot delete: no trash folder detected on this account');
    }

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
    const trashFolder = await this.resolveTrashFolder(accountId);
    if (!trashFolder) {
      return {
        deleted: 0,
        failed: uids.length,
        errors: ['No trash folder detected on this account'],
      };
    }
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

  async moveEmail(
    accountId: string,
    folderName: string,
    uid: number,
    targetFolder: string,
    options?: { createDestinationIfMissing?: boolean },
  ): Promise<{ path: string; destination: string; destinationCreated?: boolean; uidMap?: Map<number, number> }> {
    const client = await this.ensureConnected(accountId);

    let destinationCreated = false;
    if (options?.createDestinationIfMissing) {
      const exists = await this.folderExists(accountId, targetFolder);
      if (!exists) {
        await this.createFolder(accountId, targetFolder);
        destinationCreated = true;
      }
    }

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      const result = await client.messageMove(uid, targetFolder, { uid: true });

      if (!result) {
        throw new Error(`Failed to move email UID ${uid} from ${folderName} to ${targetFolder}`);
      }

      return {
        path: result.path,
        destination: result.destination,
        destinationCreated: destinationCreated || undefined,
        uidMap: result.uidMap,
      };
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async folderExists(accountId: string, folderPath: string): Promise<boolean> {
    const client = await this.ensureConnected(accountId);
    const list = await client.list();
    return list.some(f => f.path === folderPath);
  }

  async createFolder(
    accountId: string,
    folderPath: string,
  ): Promise<{ path: string; created: boolean; alreadyExisted: boolean }> {
    const client = await this.ensureConnected(accountId);
    try {
      const result = await client.mailboxCreate(folderPath);
      const path = (result && typeof result === 'object' && 'path' in result) ? (result as any).path : folderPath;
      const created = (result && typeof result === 'object' && 'created' in result) ? Boolean((result as any).created) : true;
      return {
        path,
        created,
        alreadyExisted: !created,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ImapFlow throws on already-existing mailboxes; treat that as a non-error.
      if (/already exists|exists/i.test(message)) {
        return { path: folderPath, created: false, alreadyExisted: true };
      }
      throw new Error(`Failed to create folder "${folderPath}": ${message}`);
    }
  }

  async findThreadMessages(
    accountId: string,
    sourceFolder: string,
    searchFolder: string,
    options?: { searchReferences?: boolean },
  ): Promise<{ messageIds: string[]; uids: number[] }> {
    const client = await this.ensureConnected(accountId);
    const includeReferences = options?.searchReferences !== false;

    // 1) Collect Message-IDs from sourceFolder
    const messageIds: string[] = [];
    let lock = await client.getMailboxLock(sourceFolder);
    try {
      const allUids = await client.search({ all: true }, { uid: true });
      if (allUids && allUids.length > 0) {
        for await (const msg of client.fetch(allUids, { uid: true, envelope: true }, { uid: true })) {
          if (msg.envelope?.messageId) {
            messageIds.push(msg.envelope.messageId);
          }
        }
      }
    } finally {
      lock.release();
    }

    if (messageIds.length === 0) {
      return { messageIds: [], uids: [] };
    }

    // 2) For each Message-ID, search In-Reply-To (and optionally References) in searchFolder
    const foundUids = new Set<number>();
    lock = await client.getMailboxLock(searchFolder);
    try {
      for (const msgId of messageIds) {
        try {
          const inReplyMatches = await client.search(
            { header: { 'in-reply-to': msgId } as any },
            { uid: true },
          );
          for (const uid of inReplyMatches || []) foundUids.add(uid);

          if (includeReferences) {
            const refMatches = await client.search(
              { header: { 'references': msgId } as any },
              { uid: true },
            );
            for (const uid of refMatches || []) foundUids.add(uid);
          }
        } catch {
          // Skip per-message errors so one bad search doesn't kill the whole sweep
        }
      }
    } finally {
      lock.release();
    }

    return {
      messageIds,
      uids: Array.from(foundUids).sort((a, b) => a - b),
    };
  }

  async appendToSentFolder(accountId: string, rawMessage: Buffer | string): Promise<boolean> {
    const sentFolderNames = [
      // English / standard
      'Sent Messages', 'Sent', 'INBOX.Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail',
      // French (Outlook / Exchange / Sherweb)
      'Éléments envoyés', 'Eléments envoyés', 'Messages envoyés',
      // German
      'Gesendet', 'Gesendete Elemente', 'Gesendete Objekte',
      // Spanish
      'Enviados', 'Elementos enviados',
      // Portuguese
      'Enviados', 'Itens Enviados',
      // Italian
      'Inviati', 'Posta inviata',
      // Dutch
      'Verzonden', 'Verzonden items',
    ];
    const folder = await this.findSpecialUseFolder(accountId, '\\Sent', sentFolderNames);
    if (!folder) {
      console.warn(`[IMAP] No sent folder found for account ${accountId}. Tried SPECIAL-USE flag \\Sent + names: ${sentFolderNames.join(', ')}`);
      return false;
    }
    return this.appendMessage(accountId, folder, rawMessage, ['\\Seen']);
  }

  async findFolderByNames(accountId: string, candidates: string[]): Promise<string | undefined> {
    const folders = await this.listFolders(accountId);
    return folders.find(f => candidates.includes(f.name))?.name;
  }

  /**
   * Find a folder by IMAP SPECIAL-USE flag (RFC 6154) first, with fallback
   * to a list of localized folder names.
   *
   * SPECIAL-USE flags (\Sent, \Drafts, \Trash, \Junk, \Archive) are language-
   * independent and work with any IMAP server that advertises them. This
   * resolves localized folder names (e.g. "Éléments envoyés" on Sherweb /
   * Outlook FR) without needing to hardcode every language.
   *
   * Fallback to name list keeps backward compatibility with older servers
   * that don't advertise SPECIAL-USE flags.
   */
  async findSpecialUseFolder(
    accountId: string,
    specialUseFlag: string,
    fallbackNames: string[],
  ): Promise<string | undefined> {
    const folders = await this.listFolders(accountId);
    const target = specialUseFlag.toLowerCase();

    // Priority 1: imapflow's parsed specialUse field (RFC 6154 — language-
    // independent, most reliable). imapflow derives this from the LIST
    // SPECIAL-USE response and exposes it per mailbox.
    const specialUseMatch = folders.find(f => f.specialUse?.toLowerCase() === target);
    if (specialUseMatch) {
      return specialUseMatch.name;
    }

    // Priority 2: raw SPECIAL-USE flag in the mailbox attributes, for servers
    // that advertise it as a LIST flag but where imapflow didn't map it.
    const flagMatch = folders.find(f =>
      f.attributes.some(a => typeof a === 'string' && a.toLowerCase() === target)
    );
    if (flagMatch) {
      return flagMatch.name;
    }

    // Priority 3: localized name match (fallback for older servers that don't
    // advertise SPECIAL-USE at all).
    return folders.find(f => fallbackNames.includes(f.name))?.name;
  }

  async findDraftsFolder(accountId: string): Promise<string | undefined> {
    const draftsFolderNames = [
      // English
      'Drafts', 'Draft', 'INBOX.Drafts', 'INBOX.Draft', '[Gmail]/Drafts',
      // French
      'Brouillons',
      // German
      'Entwürfe',
      // Spanish
      'Borradores',
      // Portuguese
      'Rascunhos',
      // Italian
      'Bozze',
      // Dutch
      'Concepten',
    ];
    return this.findSpecialUseFolder(accountId, '\\Drafts', draftsFolderNames);
  }

  async appendMessage(accountId: string, folder: string, rawMessage: Buffer | string, flags?: string[]): Promise<boolean> {
    const client = await this.ensureConnected(accountId);
    try {
      await client.append(folder, rawMessage, flags ?? []);
      return true;
    } catch (err) {
      console.error(`[IMAP] Failed to append to ${folder}:`, err instanceof Error ? err.message : err);
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
        error: enrichConnectionError(err, account.host),
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

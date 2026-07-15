import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, EmailBodyFormat, EmailLocation, Folder, SearchCriteria, SearchOptions, DEFAULT_BODY_MAX_LENGTH, DEFAULT_BODY_FORMAT, isSystemFlag } from '../types/index.js';
import type { AccountManager } from './account-manager.js';
import { htmlToMarkdown, normalizeWhitespace } from './html-to-markdown.js';

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
  // Controls how the body is returned. 'markdown' (default) returns markdownContent and omits
  // raw htmlContent so HTML never crosses the MCP boundary; 'html' keeps the legacy raw HTML;
  // 'text' returns plain text only; 'auto' prefers a substantive text/plain part, else markdown.
  bodyFormat?: EmailBodyFormat;
  // Minimum length of a text/plain part to treat it as the substantive body (markdown/auto).
  markdownThreshold?: number;
}

/**
 * Per-uid result returned by `moveEmail` when an array of UIDs is supplied.
 * `uidMap` is the server's mapping (source uid → destination uid); populated
 * when the server reports it, omitted otherwise.
 */
export interface MoveEmailBatchResultItem {
  uid: number;
  destination: string;
  uidMap?: Record<number, number>;
}

export interface MoveEmailBatchResult {
  path: string;
  destination: string;
  destinationCreated?: boolean;
  results: MoveEmailBatchResultItem[];
}

/**
 * Parse a raw RFC 822 header block into a map of lowercased header name → value.
 * Handles header folding (continuation lines starting with whitespace) and
 * joins repeated headers (e.g. multiple `Received`/`Authentication-Results`)
 * with newlines. Intentionally lightweight — no MIME word decoding — because
 * callers use it for plain string/regex matching (spam header analysis).
 */
export function parseRawHeaders(raw: Buffer | string): Record<string, string> {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const headers: Record<string, string> = {};
  let current: { key: string; value: string } | null = null;

  const commit = () => {
    if (!current) return;
    const key = current.key.toLowerCase().trim();
    const val = current.value.trim();
    if (key) {
      headers[key] = headers[key] !== undefined ? `${headers[key]}\n${val}` : val;
    }
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue;
    if (/^[ \t]/.test(line)) {
      // Folded continuation of the previous header.
      if (current) current.value += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    commit();
    current = { key: line.slice(0, idx), value: line.slice(idx + 1) };
  }
  commit();

  return headers;
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
      // Validate the certificate against the host we actually dial. On a
      // STARTTLS upgrade imapflow passes no host to Node's TLS layer, and for
      // an IP host it also omits the SNI servername, so Node would otherwise
      // check the cert against a default of "localhost" and reject a cert
      // bound to e.g. 127.0.0.1 (local bridges like ProtonMail Bridge).
      tls: { host: account.host },
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

  /**
   * Search a folder by criteria. By default returns lightweight headers only;
   * set `options.includeBody = true` to fetch the RFC822 source in the same
   * round-trip and parse the body with mailparser (markdown by default,
   * matching `imap_get_email`).
   *
   * Backwards-compatible: when `options` is omitted or `includeBody` is
   * false, the returned shape is identical to the previous version — no
   * body fields attached.
   */
  async searchEmails(
    accountId: string,
    folderName: string,
    criteria: SearchCriteria,
    options?: SearchOptions,
  ): Promise<EmailMessage[]> {
    const client = await this.ensureConnected(accountId);
    const includeBody = options?.includeBody === true;
    const bodyMaxLength = options?.bodyMaxLength ?? DEFAULT_BODY_MAX_LENGTH;

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const searchQuery = this.buildSearchQuery(criteria);
      const uids = await client.search(searchQuery, { uid: true });

      if (!uids || uids.length === 0) {
        return [];
      }

      // Fetch envelopes + flags + internalDate, and — when includeBody — the
      // RFC822 source in the same round-trip (one `client.fetch` call).
      // Including `source: true` lets us parse the body with mailparser
      // without an extra fetch per message.
      const fetchQuery: any = {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        ...(includeBody ? { source: true } : {}),
      };

      const messages: EmailMessage[] = [];

      for await (const msg of client.fetch(uids, fetchQuery, { uid: true })) {
        const flags = Array.from(msg.flags || []) as string[];
        const base: EmailMessage = {
          uid: msg.uid,
          date: new Date(msg.internalDate || msg.envelope?.date || Date.now()),
          from: msg.envelope?.from?.[0] ? this.formatAddress(msg.envelope.from[0]) : '',
          to: msg.envelope?.to?.map((addr: any) => this.formatAddress(addr)) || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          flags,
          customKeywords: flags.filter(f => !isSystemFlag(f)),
        };

        if (!includeBody || !msg.source) {
          messages.push(base);
          continue;
        }

        try {
          const rendered = await this.buildEmailContentFromSource(msg.uid, msg.source, msg.flags, {
            bodyFormat: options?.bodyFormat ?? DEFAULT_BODY_FORMAT,
            bodyMaxLength,
            includeAttachmentText: false,
          });
          messages.push(this.mergeBodyIntoMessage(base, rendered, options?.bodyFormat ?? DEFAULT_BODY_FORMAT));
        } catch {
          // Parsing one source failed — keep the headers, omit body fields.
          messages.push(base);
        }
      }

      return messages;
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  /**
   * Fetch the raw headers for a set of UIDs in a single round-trip and return a
   * map of uid → parsed header record (lowercased header names). Does **not**
   * fetch or parse message bodies — used for lightweight header analysis such
   * as spam indicator checks. UIDs with no headers returned are omitted.
   */
  async fetchHeadersForUids(
    accountId: string,
    folderName: string,
    uids: number[],
  ): Promise<Map<number, Record<string, string>>> {
    const result = new Map<number, Record<string, string>>();
    if (!uids || uids.length === 0) {
      return result;
    }

    const client = await this.ensureConnected(accountId);
    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      for await (const msg of client.fetch(uids, { uid: true, headers: true }, { uid: true })) {
        if (!msg.headers) continue;
        result.set(msg.uid, parseRawHeaders(msg.headers));
      }
      return result;
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  /**
   * Get the newest `count` messages in `folderName`. By default returns
   * lightweight headers only; set `options.includeBody = true` to also fetch
   * and parse the body of each message.
   *
   * Backwards-compatible: when `options` is omitted, the returned shape is
   * identical to the previous version.
   */
  async getLatestEmails(
    accountId: string,
    folderName: string,
    count: number,
    options?: SearchOptions,
  ): Promise<EmailMessage[]> {
    const client = await this.ensureConnected(accountId);
    const includeBody = options?.includeBody === true;
    const bodyMaxLength = options?.bodyMaxLength ?? DEFAULT_BODY_MAX_LENGTH;

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);

      const uids = await client.search({ all: true }, { uid: true });
      if (!uids || uids.length === 0) {
        return [];
      }

      const latestUids = [...uids].sort((a, b) => a - b).slice(-count);

      const fetchQuery: any = {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        ...(includeBody ? { source: true } : {}),
      };

      const messages: EmailMessage[] = [];

      for await (const msg of client.fetch(latestUids, fetchQuery, { uid: true })) {
        const flags = Array.from(msg.flags || []) as string[];
        const base: EmailMessage = {
          uid: msg.uid,
          date: new Date(msg.internalDate || msg.envelope?.date || Date.now()),
          from: msg.envelope?.from?.[0] ? this.formatAddress(msg.envelope.from[0]) : '',
          to: msg.envelope?.to?.map((addr: any) => this.formatAddress(addr)) || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          flags,
          customKeywords: flags.filter(f => !isSystemFlag(f)),
        };

        if (!includeBody || !msg.source) {
          messages.push(base);
          continue;
        }

        try {
          const rendered = await this.buildEmailContentFromSource(msg.uid, msg.source, msg.flags, {
            bodyFormat: options?.bodyFormat ?? DEFAULT_BODY_FORMAT,
            bodyMaxLength,
            includeAttachmentText: false,
          });
          messages.push(this.mergeBodyIntoMessage(base, rendered, options?.bodyFormat ?? DEFAULT_BODY_FORMAT));
        } catch {
          // One source failed to parse — keep the headers, drop the body.
          messages.push(base);
        }
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

      return await this.buildEmailContentFromSource(uid, source.source, source.flags, options);
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  /**
   * Parse a raw RFC822 source Buffer with mailparser and render body/header
   * fields according to `options`. Used by both `getEmailContent` (single
   * message) and the includeBody paths in `searchEmails`/`getLatestEmails`/
   * `findThreadMessages` so body rendering stays in one place.
   *
   * `bodyMaxLength` caps each populated body field independently. Search /
   * latest / thread callers pass a small cap (default 10000) to protect the
   * context window when returning many messages at once; `getEmailContent`
   * leaves it undefined so the caller-controlled `maxContentLength` (in
   * `email-tools.ts`) applies unchanged.
   */
  private async buildEmailContentFromSource(
    uid: number,
    source: Buffer,
    flags: any,
    options: EmailContentOptions & { bodyMaxLength?: number } = {}
  ): Promise<EmailContent> {
    const {
      includeAttachmentText = false,
      maxAttachmentTextBytes = 256 * 1024,
      maxAttachmentTextChars = 100000,
      bodyFormat = 'markdown',
      markdownThreshold = 200,
      bodyMaxLength,
    } = options;

    const parsed = await simpleParser(source);
    const flagArray = Array.from(flags || []) as string[];

    const cap = (s: string | undefined): string | undefined => {
      if (s === undefined) return undefined;
      if (bodyMaxLength === undefined || bodyMaxLength <= 0) return s;
      return s.length > bodyMaxLength ? s.substring(0, bodyMaxLength) : s;
    };

    // Body assembly per bodyFormat. The point is that raw HTML never crosses the boundary
    // unless explicitly requested via bodyFormat: 'html'.
    const rawText = parsed.text || undefined;
    const rawHtml = parsed.html || undefined;
    let textContent: string | undefined;
    let htmlContent: string | undefined;
    let markdownContent: string | undefined;

    if (bodyFormat === 'html') {
      textContent = cap(rawText);
      htmlContent = cap(rawHtml);
    } else if (bodyFormat === 'text') {
      // Plain text if present, else a tag-stripped/normalized rendering of the HTML.
      const baseText = rawText ? normalizeWhitespace(rawText) : (rawHtml ? htmlToMarkdown(rawHtml) : undefined);
      textContent = cap(baseText);
    } else {
      // 'markdown' (default) and 'auto': prefer a substantive text/plain part, else convert HTML.
      const cleanText = rawText ? normalizeWhitespace(rawText) : '';
      if (cleanText.length >= markdownThreshold) {
        markdownContent = cleanText;
      } else if (rawHtml) {
        markdownContent = htmlToMarkdown(rawHtml);
      } else {
        markdownContent = cleanText || undefined;
      }
      // Keep textContent for backward compatibility with consumers that still read it.
      textContent = rawText;
      markdownContent = cap(markdownContent);
    }

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
      flags: flagArray,
      customKeywords: flagArray.filter(f => !isSystemFlag(f)),
      headers,
      textContent,
      htmlContent,
      markdownContent,
      bodyFormat,
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
            const { PDFParse } = await import('pdf-parse');
            const contentBuffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
            const pdfParser = new PDFParse({ data: contentBuffer });
            let rawText: string;
            try {
              const pdfData = await pdfParser.getText({ pageJoiner: '' });
              rawText = pdfData.text;
            } finally {
              await pdfParser.destroy();
            }
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
  }

  /**
   * Merge body fields rendered by `buildEmailContentFromSource` into a
   * lightweight `EmailMessage` returned by the search / latest / thread paths.
   * Only the body fields relevant to the requested `bodyFormat` are attached
   * (raw HTML stays out unless `bodyFormat: 'html'` was requested).
   */
  private mergeBodyIntoMessage(
    base: EmailMessage,
    rendered: EmailContent,
    bodyFormat: EmailBodyFormat,
  ): EmailMessage & {
    textContent?: string;
    htmlContent?: string;
    markdownContent?: string;
    bodyFormat: EmailBodyFormat;
  } {
    return {
      ...base,
      // Always prefer the body field the caller asked for, fall back to any
      // populated body field so a single-mode consumer never gets an empty
      // result when the message happened to only carry text/plain (markdown
      // mode returns textContent populated as a side-effect — preserve it).
      markdownContent: rendered.markdownContent,
      textContent: rendered.textContent,
      ...(bodyFormat === 'html' ? { htmlContent: rendered.htmlContent } : {}),
      bodyFormat,
    };
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

  /**
   * Mark messages as read.
   *
   * Single-uid calls return `void` (unchanged). When `uids` is an array, the
   * IMAP server's UID sequence-set is used so all flags flip in one call.
   * Returns a per-uid report — failed UIDs are listed in `errors`, never
   * surfaced as a thrown error, so partial failure is observable.
   */
  async markAsRead(
    accountId: string,
    folderName: string,
    uids: number | number[],
  ): Promise<{ success: boolean; marked: number[]; failed: number[]; errors?: string[] }> {
    return this.flagBatch(accountId, folderName, uids, 'add');
  }

  async markAsUnread(
    accountId: string,
    folderName: string,
    uids: number | number[],
  ): Promise<{ success: boolean; marked: number[]; failed: number[]; errors?: string[] }> {
    return this.flagBatch(accountId, folderName, uids, 'remove');
  }

  /**
   * Add or remove the \\Seen flag on one or many UIDs in one mailbox.
   *
   * For a single UID: returns `marked: [uid]` on success. For an array, all
   * UIDs go into a single sequence-set so we hit the server with one
   * `messageFlagsAdd`/`messageFlagsRemove` call (instead of N) — that's the
   * core of the #106 batch-UIDs performance win.
   *
   * On error, the whole batch fails and the failed uid(s) are reported.
   * imapflow's `messageFlagsAdd`/`messageFlagsRemove` is atomic at the
   * IMAP-server level (one command), so partial-success handling for an
   * array is unnecessary; the IMAP server either flips them all or rejects.
   */
  private async flagBatch(
    accountId: string,
    folderName: string,
    uids: number | number[],
    mode: 'add' | 'remove',
  ): Promise<{ success: boolean; marked: number[]; failed: number[]; errors?: string[] }> {
    const uidList = Array.isArray(uids) ? uids : [uids];
    if (uidList.length === 0) {
      return { success: true, marked: [], failed: [] };
    }

    const client = await this.ensureConnected(accountId);
    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      // imapflow accepts both a single UID/number and an IMAP sequence-set
      // string ("1,2,3" or "1:5"). For an array we join as a sequence-set;
      // for a single uid we pass the number directly (preserves prior shape).
      const target: number | string = uidList.length === 1 ? uidList[0] : uidList.join(',');
      if (mode === 'add') {
        await client.messageFlagsAdd(target, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(target, ['\\Seen'], { uid: true });
      }
      return { success: true, marked: [...uidList], failed: [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        marked: [],
        failed: [...uidList],
        errors: [`Failed to ${mode === 'add' ? 'mark as read' : 'mark as unread'} UIDs [${uidList.join(', ')}]: ${message}`],
      };
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async flagEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true });
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async unflagEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      await client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async addKeyword(accountId: string, folderName: string, uid: number, keyword: string): Promise<void> {
    if (isSystemFlag(keyword)) {
      throw new Error(
        `"${keyword}" is a system flag, not a custom keyword. Use the dedicated tool instead ` +
        `(e.g. imap_flag_email for \\Flagged, imap_mark_as_read for \\Seen).`
      );
    }

    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      const result = await client.messageFlagsAdd(uid, [keyword], { uid: true });
      if (!result) {
        throw new Error(`Server did not apply keyword "${keyword}" to email UID ${uid} in ${folderName} (message not found or server rejected the change)`);
      }
    } finally {
      if (lock) {
        lock.release();
      }
    }
  }

  async removeKeyword(accountId: string, folderName: string, uid: number, keyword: string): Promise<void> {
    if (isSystemFlag(keyword)) {
      throw new Error(
        `"${keyword}" is a system flag, not a custom keyword. Use the dedicated tool instead ` +
        `(e.g. imap_flag_email for \\Flagged, imap_mark_as_read for \\Seen).`
      );
    }

    const client = await this.ensureConnected(accountId);

    let lock;
    try {
      lock = await client.getMailboxLock(folderName);
      const result = await client.messageFlagsRemove(uid, [keyword], { uid: true });
      if (!result) {
        throw new Error(`Server did not remove keyword "${keyword}" from email UID ${uid} in ${folderName} (message not found or server rejected the change)`);
      }
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

  /**
   * Move one email or a batch of emails from `folderName` to `targetFolder`.
   *
   * - Single UID (number): returns the existing single-uid shape `{ path,
   *   destination, destinationCreated?, uidMap? }` (unchanged).
   * - Array of UIDs: returns `{ path, destination, destinationCreated?,
   *   results: [{ uid, destination, uidMap? }, …] }`. Per-uid errors are
   *   reported in the result rather than thrown so partial failures are
   *   observable — a single bad UID should not lose the work done for
   *   siblings. `createDestinationIfMissing` is honored once up front.
   */
  async moveEmail(
    accountId: string,
    folderName: string,
    uids: number | number[],
    targetFolder: string,
    options?: { createDestinationIfMissing?: boolean },
  ): Promise<
    | {
        path: string;
        destination: string;
        destinationCreated?: boolean;
        uidMap?: Map<number, number>;
      }
    | MoveEmailBatchResult
  > {
    const isBatch = Array.isArray(uids);
    const uidList = isBatch ? (uids as number[]) : [uids as number];

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

      // For a batch we move one UID at a time so we can attribute errors
      // per-uid. imapflow's `messageMove` accepts a sequence-set, but a
      // sequence-set either succeeds atomically or fails entirely — a
      // mid-batch failure with no per-uid attribution would be a regression
      // vs the existing single-uid error contract.
      const results: MoveEmailBatchResultItem[] = [];
      let firstResult: { path: string; destination: string; uidMap?: Map<number, number> } | null = null;
      let firstPath = folderName;

      for (const uid of uidList) {
        try {
          const result = await client.messageMove(uid, targetFolder, { uid: true });
          if (!result) {
            throw new Error(`Server returned no result for UID ${uid}`);
          }
          if (!firstResult) {
            firstResult = { path: result.path, destination: result.destination, uidMap: result.uidMap };
            firstPath = result.path;
          }
          const uidMapRecord = result.uidMap ? Object.fromEntries(result.uidMap) : undefined;
          results.push({
            uid,
            destination: result.destination,
            ...(uidMapRecord ? { uidMap: uidMapRecord } : {}),
          });
        } catch (err) {
          if (isBatch) {
            // Per-uid error inside a batch: keep going and report.
            results.push({
              uid,
              destination: targetFolder,
              uidMap: undefined as unknown as Record<number, number>,
            });
            // Annotate the failure on the item by attaching a non-enumerable
            // error? Easier: surface via a separate sibling array — but to
            // keep the public shape tight, throw and let the caller iterate.
            // For #106 we keep the iteration going but record the failure.
            (results[results.length - 1] as any).error =
              err instanceof Error ? err.message : String(err);
          } else {
            // Single-uid failure — preserve prior behavior (throw).
            throw new Error(
              `Failed to move email UID ${uid} from ${folderName} to ${targetFolder}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }

      if (!isBatch) {
        // Single-uid — keep the legacy shape exactly so existing callers
        // don't see any change.
        return {
          path: firstResult?.path ?? firstPath,
          destination: firstResult?.destination ?? targetFolder,
          destinationCreated: destinationCreated || undefined,
          uidMap: firstResult?.uidMap,
        };
      }

      return {
        path: firstResult?.path ?? firstPath,
        destination: targetFolder,
        destinationCreated: destinationCreated || undefined,
        results,
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

  /**
   * Find messages in `searchFolder` that belong to the same conversation
   * threads as messages already in `sourceFolder`.
   *
   * Returns `{ messageIds, uids }` and — when `options.includeBody` is true —
   * an additional `messages` array with full body for each matched UID,
   * formatted like `imap_get_email` (markdown by default). `searchReferences`
   * is honored as before (default true).
   *
   * Backwards-compatible: when `includeBody` is omitted, the returned shape
   * is identical to the previous version.
   */
  async findThreadMessages(
    accountId: string,
    sourceFolder: string,
    searchFolder: string,
    options?: { searchReferences?: boolean; includeBody?: boolean; bodyFormat?: EmailBodyFormat; bodyMaxLength?: number },
  ): Promise<{
    messageIds: string[];
    uids: number[];
    messages?: Array<EmailMessage & {
      textContent?: string;
      htmlContent?: string;
      markdownContent?: string;
      bodyFormat: EmailBodyFormat;
    }>;
  }> {
    const client = await this.ensureConnected(accountId);
    const includeReferences = options?.searchReferences !== false;
    const includeBody = options?.includeBody === true;
    const bodyMaxLength = options?.bodyMaxLength ?? DEFAULT_BODY_MAX_LENGTH;
    const bodyFormat = options?.bodyFormat ?? DEFAULT_BODY_FORMAT;

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

    const sortedUids = Array.from(foundUids).sort((a, b) => a - b);

    if (!includeBody || sortedUids.length === 0) {
      return { messageIds, uids: sortedUids };
    }

    // 3) Optionally fetch envelopes + body for each found UID in one round-trip.
    // Caller-side: the body is rendered with the same `bodyFormat` as
    // `imap_get_email`, capped by `bodyMaxLength` (default 10000).
    const messages: Array<EmailMessage & {
      textContent?: string;
      htmlContent?: string;
      markdownContent?: string;
      bodyFormat: EmailBodyFormat;
    }> = [];
    lock = await client.getMailboxLock(searchFolder);
    try {
      const fetchQuery: any = {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        source: true,
      };
      for await (const msg of client.fetch(sortedUids, fetchQuery, { uid: true })) {
        const flags = Array.from(msg.flags || []) as string[];
        const base: EmailMessage = {
          uid: msg.uid,
          date: new Date(msg.internalDate || msg.envelope?.date || Date.now()),
          from: msg.envelope?.from?.[0] ? this.formatAddress(msg.envelope.from[0]) : '',
          to: msg.envelope?.to?.map((addr: any) => this.formatAddress(addr)) || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          flags,
          customKeywords: flags.filter(f => !isSystemFlag(f)),
        };
        if (!msg.source) {
          messages.push({ ...base, bodyFormat });
          continue;
        }
        try {
          const rendered = await this.buildEmailContentFromSource(msg.uid, msg.source, msg.flags, {
            bodyFormat,
            bodyMaxLength,
            includeAttachmentText: false,
          });
          messages.push(this.mergeBodyIntoMessage(base, rendered, bodyFormat));
        } catch {
          messages.push({ ...base, bodyFormat });
        }
      }
    } finally {
      lock.release();
    }

    return { messageIds, uids: sortedUids, messages };
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
      // Validate the certificate against the host we actually dial; see connect().
      tls: { host: account.host },
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
    if (criteria.messageId) {
      // Apple-hosted IMAP only matches the FULL bracketed Message-ID; Gmail
      // accepts either. Send the bracketed form (works on both); callers verify
      // exact equality against the fetched envelope.messageId afterwards.
      query.header = { 'message-id': this.bracketMessageId(criteria.messageId) };
    }
    if (criteria.keywords && criteria.keywords.length > 0) {
      for (const keyword of criteria.keywords) {
        if (isSystemFlag(keyword)) {
          throw new Error(
            `"${keyword}" is a system flag, not a custom keyword. Use the dedicated params instead ` +
            `(e.g. flagged for \\Flagged, seen for \\Seen).`
          );
        }
      }
      // imapflow's `keyword` field only accepts a single string, so an OR
      // across multiple keywords is composed via imapflow's `or` (binary-tree
      // expanded internally, so any number of operands is supported).
      if (criteria.keywords.length === 1) {
        query.keyword = criteria.keywords[0];
      } else {
        query.or = criteria.keywords.map(keyword => ({ keyword }));
      }
    }
    if (criteria.unKeywords && criteria.unKeywords.length > 0) {
      for (const keyword of criteria.unKeywords) {
        if (isSystemFlag(keyword)) {
          throw new Error(
            `"${keyword}" is a system flag, not a custom keyword. Use the dedicated params instead ` +
            `(e.g. flagged for \\Flagged, seen for \\Seen).`
          );
        }
      }
      if (criteria.unKeywords.length === 1) {
        query.unKeyword = criteria.unKeywords[0];
      } else {
        // imapflow's `unKeyword` field only accepts a single string, so
        // excluding multiple keywords ANDs cleanly via De Morgan's law:
        // NOT (has k1 OR has k2 OR ...) == has none of k1, k2, ...
        query.not = { or: criteria.unKeywords.map(keyword => ({ keyword })) };
      }
    }

    // If no criteria, search all
    if (Object.keys(query).length === 0) {
      return { all: true };
    }

    return query;
  }

  private normalizeMessageId(id: string | undefined | null): string {
    if (!id) return '';
    return id.trim().replace(/^<+/, '').replace(/>+$/, '').trim().toLowerCase();
  }

  /** Full bracketed Message-ID for IMAP HEADER search (case preserved). */
  private bracketMessageId(id: string | undefined | null): string {
    const bare = String(id || '').trim().replace(/^<+/, '').replace(/>+$/, '').trim();
    return bare ? `<${bare}>` : '';
  }

  private flattenFolders(folders: Folder[]): Folder[] {
    const out: Folder[] = [];
    for (const f of folders) {
      out.push(f);
      if (f.children?.length) out.push(...this.flattenFolders(f.children));
    }
    return out;
  }

  /**
   * Folder search order for findEmailByMessageId. Gmail: the \All mailbox
   * ([Gmail]/All Mail) holds every message regardless of label, so it alone
   * finds archived/moved mail (\All excludes Trash/Spam, included explicitly).
   * Generic IMAP: INBOX → \Archive → \Sent → remaining selectable folders.
   */
  private async resolveFolderSearchOrder(accountId: string): Promise<string[]> {
    const flat = this.flattenFolders(await this.listFolders(accountId));
    const hasFlag = (f: Folder, flag: string) =>
      (f.attributes || []).some(a => a.toLowerCase() === flag.toLowerCase());

    const allMail = flat.find(f => hasFlag(f, '\\All'));
    if (allMail) {
      return [
        allMail.name,
        flat.find(f => hasFlag(f, '\\Trash'))?.name,
        flat.find(f => hasFlag(f, '\\Junk'))?.name,
      ].filter(Boolean) as string[];
    }

    const order: string[] = [];
    const pushOnce = (name?: string) => {
      if (name && !order.includes(name)) order.push(name);
    };
    pushOnce(flat.find(f => f.name.toUpperCase() === 'INBOX')?.name);
    pushOnce(flat.find(f => hasFlag(f, '\\Archive'))?.name);
    pushOnce(flat.find(f => hasFlag(f, '\\Sent'))?.name);
    for (const f of flat) {
      if (hasFlag(f, '\\Noselect')) continue;
      pushOnce(f.name);
    }
    return order;
  }

  /**
   * Locate a message by its RFC822 Message-ID across folders and return its
   * current { folder, uid }. Robust to the message having been moved/archived
   * (IMAP UIDs are folder-relative). Returns found:false if nowhere located.
   */
  async findEmailByMessageId(
    accountId: string,
    messageId: string,
    folders?: string[],
  ): Promise<EmailLocation> {
    const target = this.normalizeMessageId(messageId);
    if (!target) return { found: false, foldersSearched: [] };

    const MAX_FOLDERS = 25;
    const order = (folders && folders.length > 0
      ? folders
      : await this.resolveFolderSearchOrder(accountId)
    ).slice(0, MAX_FOLDERS);

    const foldersSearched: string[] = [];
    for (const folder of order) {
      foldersSearched.push(folder);
      let candidates: EmailMessage[];
      try {
        candidates = await this.searchEmails(accountId, folder, { messageId });
      } catch {
        // Unselectable (\Noselect) or vanished folder — skip.
        continue;
      }
      for (const msg of candidates) {
        // HEADER search is substring-matched; reject false-positives.
        if (this.normalizeMessageId(msg.messageId) === target) {
          return {
            found: true,
            folder,
            uid: msg.uid,
            messageId: msg.messageId,
            subject: msg.subject,
            from: msg.from,
            date: msg.date,
            flags: msg.flags,
            customKeywords: msg.customKeywords,
            foldersSearched,
          };
        }
      }
    }
    return { found: false, foldersSearched };
  }
}
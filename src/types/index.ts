export interface ImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  email?: string;
  loginMethod?: string;
  authTimeout?: number;
  connTimeout?: number;
  keepalive?: boolean;
  smtp?: SmtpConfig;
  saveToSent?: boolean;
  /** Explicit Sent-folder name (e.g. "Gesendet", "[Gmail]/Gesendete Objekte").
   * When set, sent-mail copies are appended here, skipping SPECIAL-USE /
   * localized-name auto-detection. Leave unset to auto-detect. */
  sentFolder?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  authMethod?: 'PLAIN' | 'LOGIN' | 'CRAM-MD5' | 'XOAUTH2';
  tls?: {
    rejectUnauthorized?: boolean;
  };
}

export interface EmailMessage {
  uid: number;
  date: Date;
  from: string;
  to: string[];
  subject: string;
  messageId: string;
  inReplyTo?: string;
  flags: string[];
  customKeywords: string[];
}

export type EmailBodyFormat = 'markdown' | 'text' | 'html' | 'auto';

export interface EmailContent extends EmailMessage {
  textContent?: string;
  htmlContent?: string;
  markdownContent?: string;
  bodyFormat?: EmailBodyFormat;
  headers: Record<string, string | string[]>;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  textContent?: string;
  textContentTruncated?: boolean;
}

/** Outcome of copying a sent message into the Sent folder. `error` explains
 * a failure instead of the save silently reporting `false` (issue #125). */
export interface SentSaveResult {
  saved: boolean;
  /** Folder the append targeted (resolved or overridden). Absent when no Sent folder could be found. */
  folder?: string;
  /** Why the save failed, when `saved` is false. */
  error?: string;
}

export interface Folder {
  name: string;
  delimiter: string;
  attributes: string[];
  /** RFC 6154 special-use attribute as parsed by imapflow (e.g. "\\Sent", "\\Drafts"). */
  specialUse?: string;
  children?: Folder[];
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
  draft?: boolean;
  messageId?: string;
  /** Match messages that have ANY of these custom keywords (server-side OR). */
  keywords?: string[];
  /** Exclude messages that have ANY of these custom keywords (server-side; result has NONE of them). */
  unKeywords?: string[];
}

/**
 * Output-shaping options for search / latest / thread-fetch operations.
 * Distinct from `SearchCriteria` (the IMAP search *filter*) — these control
 * how the returned messages are *rendered* (e.g. whether to parse and include
 * the message body, what format to use, and how big each body may be).
 */
export interface SearchOptions {
  /** When true, also fetch the RFC822 source for each matched UID, parse it
   * with mailparser, and attach body fields to each returned `EmailMessage`.
   * Defaults to false to preserve the existing lightweight-header behavior. */
  includeBody?: boolean;
  /** Body rendering mode when `includeBody` is true. Mirrors `imap_get_email`'s
   * `bodyFormat` parameter. Defaults to 'markdown' so a single raw HTML part
   * never crosses the MCP boundary unless explicitly requested. */
  bodyFormat?: EmailBodyFormat;
  /** Cap on body field length per message (per body field independently).
   * Defaults to 10000, matching `imap_get_email`'s `maxContentLength`. */
  bodyMaxLength?: number;
}

/** Default body length cap when none is supplied (matches `imap_get_email`). */
export const DEFAULT_BODY_MAX_LENGTH = 10000;
/** Default body format when `includeBody` is true and none is supplied. */
export const DEFAULT_BODY_FORMAT: EmailBodyFormat = 'markdown';

export interface EmailLocation {
  found: boolean;
  folder?: string;
  uid?: number;
  messageId?: string;
  subject?: string;
  from?: string;
  date?: Date;
  flags?: string[];
  customKeywords?: string[];
  foldersSearched?: string[];
}

export interface ConnectionPool {
  [accountId: string]: any; // IMAP connection instance
}

export interface EmailComposer {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string | string[];
}

export interface EmailAttachment {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  contentDisposition?: 'attachment' | 'inline';
  cid?: string;
}

/** RFC 3501 system flags (documentation/tests only — see isSystemFlag for the authoritative check). */
export const SYSTEM_FLAGS = ['\\Seen', '\\Answered', '\\Flagged', '\\Deleted', '\\Draft', '\\Recent'];

/** RFC 3501: all system flags (and server extensions like `\*`) are backslash-prefixed; custom keywords never are. */
export function isSystemFlag(flag: string): boolean {
  return flag.startsWith('\\');
}

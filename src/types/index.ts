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

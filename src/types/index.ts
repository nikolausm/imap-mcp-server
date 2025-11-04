// Connection state tracking
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

// Keepalive configuration
export interface KeepAliveConfig {
  interval?: number;      // TCP keepalive interval in ms (default: 10000)
  idleInterval?: number;  // IMAP IDLE interval in ms (default: 1740000 = 29 minutes)
  forceNoop?: boolean;    // Force NOOP instead of IDLE (default: true)
}

// Retry configuration
export interface RetryConfig {
  maxAttempts?: number;      // Max retry attempts (default: 5)
  initialDelay?: number;     // Initial delay in ms (default: 1000)
  maxDelay?: number;         // Max delay in ms (default: 60000)
  backoffMultiplier?: number; // Backoff multiplier (default: 2)
}

// Connection metadata for tracking
export interface ConnectionMetadata {
  state: ConnectionState;
  lastConnected?: Date;
  lastError?: Error;
  reconnectAttempts: number;
  healthCheckInterval?: NodeJS.Timeout;
}

export interface ImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  authTimeout?: number;
  connTimeout?: number;
  keepalive?: boolean | KeepAliveConfig;
  retry?: RetryConfig;
  smtp?: SmtpConfig;
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

export interface EmailContent extends EmailMessage {
  textContent?: string;
  htmlContent?: string;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface Folder {
  name: string;
  delimiter: string;
  attributes: string[];
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

// Bulk operation types
export type BulkMarkOperation = 'read' | 'unread' | 'flagged' | 'unflagged';

export type BulkFetchFields = 'headers' | 'full' | 'body';

export interface BulkOperationResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors?: Array<{ uid: number; error: string }>;
}
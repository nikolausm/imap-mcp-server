// Database types
export * from './database-types.js';

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
  // Level 3: Enhanced tracking
  circuitBreaker?: CircuitBreakerState;
  metrics?: ConnectionMetrics;
  degradationStartTime?: Date;
  cacheData?: Map<string, { data: any; timestamp: Date }>;
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
  circuitBreaker?: CircuitBreakerConfig;
  operationQueue?: OperationQueueConfig;
  degradation?: DegradationConfig;
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
export type BulkMarkOperation =
  | 'read' | 'unread'           // \Seen flag
  | 'flagged' | 'unflagged'     // \Flagged flag
  | 'answered' | 'unanswered'   // \Answered flag (RFC 9051)
  | 'draft' | 'not-draft'       // \Draft flag (RFC 9051)
  | 'deleted' | 'undeleted';    // \Deleted flag

// RFC 9051: Recommended IMAP Keywords (Issue #54)
export type ImapKeyword =
  | '$Forwarded'   // Message has been forwarded
  | '$MDNSent'     // Message Disposition Notification sent
  | '$Junk'        // Message is junk/spam
  | '$NotJunk'     // Message is NOT junk (user correction)
  | '$Phishing';   // Message is a phishing attempt

export type BulkFetchFields = 'headers' | 'full' | 'body';

export interface BulkOperationResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors?: Array<{ uid: number; error: string }>;
}

// Level 3: Circuit Breaker Pattern
export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Too many failures, reject requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;     // Number of failures before opening (default: 5)
  successThreshold?: number;     // Number of successes to close from half-open (default: 2)
  timeout?: number;              // Time in ms before trying half-open (default: 60000)
  monitoringWindow?: number;     // Rolling window for failure tracking in ms (default: 120000)
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastStateChange: Date;
  config: Required<CircuitBreakerConfig>;
}

// Level 3: Operation Queue
export interface QueuedOperation {
  id: string;
  accountId: string;
  operation: string;
  args: any[];
  timestamp: Date;
  retries: number;
  priority: number;
}

export interface OperationQueueConfig {
  maxSize?: number;           // Max queue size (default: 1000)
  maxRetries?: number;        // Max retries per operation (default: 3)
  processingInterval?: number; // Queue processing interval in ms (default: 5000)
  enablePriority?: boolean;   // Enable priority queue (default: true)
}

// Level 3: Metrics and Monitoring
export interface ConnectionMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  lastOperationTime: Date;
  uptime: number;
}

export interface OperationMetrics {
  operationName: string;
  count: number;
  successCount: number;
  failureCount: number;
  totalLatency: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  lastExecuted?: Date;
}

// Level 3: Graceful Degradation
export interface DegradationConfig {
  enableReadOnlyMode?: boolean;     // Allow reads when writes fail (default: true)
  enableCaching?: boolean;          // Cache read results (default: true)
  cacheTimeout?: number;            // Cache timeout in ms (default: 300000 = 5min)
  fallbackToLastKnown?: boolean;    // Use last known good data (default: true)
  maxDegradationTime?: number;      // Max time in degraded mode in ms (default: 3600000 = 1hr)
}

// RFC 9051: Server Capabilities (Issue #55)
export interface ServerCapabilities {
  raw: string[];              // Raw capability strings from server
  imap4rev2: boolean;         // IMAP4rev2 support
  imap4rev1: boolean;         // IMAP4rev1 support (fallback)
  authMethods: string[];      // AUTH= methods (e.g., "PLAIN", "LOGIN", "XOAUTH2")
  extensions: {
    // Core IMAP4rev2 built-ins (should all be true for compliant servers)
    namespace?: boolean;
    unselect?: boolean;
    uidplus?: boolean;
    esearch?: boolean;
    searchres?: boolean;
    enable?: boolean;
    idle?: boolean;
    saslir?: boolean;
    listExtended?: boolean;
    listStatus?: boolean;
    move?: boolean;
    literalMinus?: boolean;
    binary?: boolean;
    specialUse?: boolean;
    statusSize?: boolean;
    statusDeleted?: boolean;

    // Common optional extensions
    quota?: boolean;
    sort?: boolean;
    thread?: boolean;
    condstore?: boolean;
    qresync?: boolean;
    compress?: boolean;
    notify?: boolean;
    metadata?: boolean;

    // Allow for any other extensions
    [key: string]: boolean | undefined;
  };
}
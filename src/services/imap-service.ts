/**
 * IMAP Service with ImapFlow
 *
 * Migrated from node-imap to ImapFlow for better performance and maintainability.
 * Preserves all Level 1-3 reliability features.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 2.5.0
 * Date: 2025-11-05
 */

import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, MailboxObject, ListResponse } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  ImapAccount,
  EmailMessage,
  EmailContent,
  Folder,
  SearchCriteria,
  ConnectionState,
  ConnectionMetadata,
  BulkMarkOperation,
  BulkFetchFields,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerState,
  QueuedOperation,
  OperationQueueConfig,
  ConnectionMetrics,
  OperationMetrics,
  DegradationConfig,
  RetryConfig,
  ServerCapabilities,
  ImapKeyword,
  MailboxStatus
} from '../types/index.js';
import { LRUCache } from '../utils/memory-manager.js';

export class ImapService {
  private activeConnections: Map<string, ImapFlow> = new Map();
  private connectionMetadata: Map<string, ConnectionMetadata> = new Map();
  private accountStore: Map<string, ImapAccount> = new Map();
  private capabilitiesCache: Map<string, { capabilities: ServerCapabilities; timestamp: number }> = new Map();

  // Level 3: Operation queue with size limit (Issue #22 - prevent unbounded growth)
  private operationQueue: QueuedOperation[] = [];
  private readonly MAX_QUEUE_SIZE = 1000;
  private queueProcessorInterval?: NodeJS.Timeout;
  private operationMetrics: LRUCache<string, OperationMetrics>;

  constructor() {
    // Initialize LRU cache for operation metrics (max 1000 entries)
    // This prevents unbounded memory growth (Issue #22)
    this.operationMetrics = new LRUCache({
      maxSize: 1000,
      onEvict: (key, value) => {
        console.error(`[ImapService] Evicted metrics for: ${key}`);
      }
    });

    // Start operation queue processor (Issue #21)
    this.startQueueProcessor();
  }

  /**
   * Queue an operation for later processing (when connection is unavailable)
   * Implements size limit to prevent unbounded growth (Issue #22)
   */
  private queueOperation(operation: QueuedOperation): void {
    if (this.operationQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest operation (FIFO)
      const removed = this.operationQueue.shift();
      console.error(`[ImapService] Queue full, dropped operation: ${removed?.operation}`);
    }
    this.operationQueue.push(operation);
    console.error(`[ImapService] Queued operation: ${operation.operation} (queue size: ${this.operationQueue.length})`);
  }

  /**
   * Start the operation queue processor (Issue #21)
   * Processes queued operations at regular intervals
   */
  private startQueueProcessor(): void {
    const processingInterval = 5000; // Process every 5 seconds

    this.queueProcessorInterval = setInterval(async () => {
      await this.processQueue();
    }, processingInterval);

    console.error('[ImapService] Operation queue processor started');
  }

  /**
   * Process queued operations (Issue #21)
   * Attempts to execute operations that were queued due to connection issues
   */
  private async processQueue(): Promise<void> {
    if (this.operationQueue.length === 0) {
      return;
    }

    console.error(`[ImapService] Processing queue (${this.operationQueue.length} operations pending)`);

    // Sort by priority (higher first) and timestamp (older first)
    this.operationQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.timestamp.getTime() - b.timestamp.getTime(); // Older first
    });

    // Process operations
    const processedIndices: number[] = [];

    for (let i = 0; i < this.operationQueue.length; i++) {
      const op = this.operationQueue[i];

      // Check if connection is available
      const metadata = this.connectionMetadata.get(op.accountId);
      if (!metadata || metadata.state !== ConnectionState.CONNECTED) {
        continue; // Skip if not connected
      }

      // Check max retries
      if (op.retries >= 3) {
        console.error(`[ImapService] Dropping operation ${op.operation} after ${op.retries} retries`);
        processedIndices.push(i);
        continue;
      }

      try {
        // Execute the operation based on its type
        await this.executeQueuedOperation(op);
        processedIndices.push(i);
        console.error(`[ImapService] Successfully executed queued operation: ${op.operation}`);
      } catch (error) {
        console.error(`[ImapService] Failed to execute queued operation ${op.operation}:`, error);
        op.retries++;

        // Move to end of queue if still has retries
        if (op.retries < 3) {
          this.operationQueue.splice(i, 1);
          this.operationQueue.push(op);
          processedIndices.push(i);
        }
      }
    }

    // Remove processed operations (in reverse order to maintain indices)
    for (let i = processedIndices.length - 1; i >= 0; i--) {
      this.operationQueue.splice(processedIndices[i], 1);
    }
  }

  /**
   * Execute a queued operation (Issue #21)
   * Dynamically calls the appropriate method based on operation type
   */
  private async executeQueuedOperation(op: QueuedOperation): Promise<void> {
    const methodName = op.operation as keyof ImapService;
    const method = this[methodName];

    if (typeof method === 'function') {
      await (method as Function).apply(this, op.args);
    } else {
      throw new Error(`Unknown operation: ${op.operation}`);
    }
  }

  /**
   * Stop the queue processor (cleanup)
   */
  destroy(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = undefined;
      console.error('[ImapService] Operation queue processor stopped');
    }
  }

  /**
   * Level 2: Connect with auto-reconnect and state tracking
   * ImapFlow simplifies connection management significantly
   */
  async connect(account: ImapAccount, isReconnect = false): Promise<void> {
    const accountId = account.id;

    // Store account for reconnection
    this.accountStore.set(accountId, account);

    // Update state
    this.updateConnectionState(accountId, isReconnect ? ConnectionState.RECONNECTING : ConnectionState.CONNECTING);

    // If already connected, return
    if (this.activeConnections.has(accountId) && !isReconnect) {
      this.updateConnectionState(accountId, ConnectionState.CONNECTED);
      return;
    }

    try {
      const client = new ImapFlow({
        host: account.host,
        port: account.port,
        secure: account.tls,
        auth: {
          user: account.user,
          pass: account.password
        },
        logger: false, // Disable ImapFlow logging (we use our own)
        emitLogs: false,
        verifyOnly: false,
        // ImapFlow has built-in keepalive, but we can configure it
        socketTimeout: account.connTimeout || 10000,
        greetingTimeout: account.authTimeout || 3000
      });

      // Set up event listeners
      client.on('error', (err) => {
        console.error(`[IMAP] Connection error for account ${accountId}:`, err.message);
        this.updateConnectionState(accountId, ConnectionState.ERROR);
        this.recordCircuitBreakerFailure(accountId);

        // Attempt reconnect
        this.scheduleReconnect(accountId);
      });

      client.on('close', () => {
        console.error(`[IMAP] Connection closed for account ${accountId}`);
        this.activeConnections.delete(accountId);
        this.updateConnectionState(accountId, ConnectionState.DISCONNECTED);
      });

      // Connect
      await client.connect();

      this.activeConnections.set(accountId, client);
      this.updateConnectionState(accountId, ConnectionState.CONNECTED);

      const metadata = this.connectionMetadata.get(accountId);
      if (metadata) {
        metadata.lastConnected = new Date();
        metadata.reconnectAttempts = 0;
      }

      console.error(`[IMAP] Connection established for account ${accountId}`);
    } catch (error) {
      console.error(`[IMAP] Failed to connect account ${accountId}:`, error);
      this.updateConnectionState(accountId, ConnectionState.ERROR);
      this.recordCircuitBreakerFailure(accountId);
      throw error;
    }
  }

  /**
   * Level 2: Automatic reconnection with exponential backoff
   */
  private async reconnect(accountId: string): Promise<void> {
    const account = this.accountStore.get(accountId);
    if (!account) {
      console.error(`[IMAP] Cannot reconnect - account ${accountId} not found`);
      return;
    }

    const metadata = this.connectionMetadata.get(accountId) || this.initializeMetadata(accountId);
    const retryConfig = this.getRetryConfig(account.retry);

    // Calculate backoff delay
    const delay = Math.min(
      retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, metadata.reconnectAttempts),
      retryConfig.maxDelay
    );

    console.error(`[IMAP] Scheduling reconnection for ${accountId} in ${delay}ms (attempt ${metadata.reconnectAttempts + 1}/${retryConfig.maxAttempts})`);

    metadata.reconnectAttempts++;

    if (metadata.reconnectAttempts >= retryConfig.maxAttempts) {
      console.error(`[IMAP] Max reconnection attempts reached for ${accountId}`);
      this.updateConnectionState(accountId, ConnectionState.ERROR);
      return;
    }

    setTimeout(async () => {
      try {
        await this.connect(account, true);
      } catch (error) {
        console.error(`[IMAP] Reconnection failed for ${accountId}:`, error);
      }
    }, delay);
  }

  private scheduleReconnect(accountId: string): void {
    // Debounce reconnection attempts
    setTimeout(() => {
      this.reconnect(accountId);
    }, 1000);
  }

  /**
   * Level 2: Retry wrapper for all operations
   */
  private async withRetry<T>(
    accountId: string,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const account = this.accountStore.get(accountId);
    const retryConfig = this.getRetryConfig(account?.retry);
    const metadata = this.connectionMetadata.get(accountId);

    // Check circuit breaker
    if (metadata?.circuitBreaker?.state === CircuitState.OPEN) {
      const error = new Error('Circuit breaker is OPEN');
      console.error(`[IMAP] ${operationName} blocked by circuit breaker for ${accountId}`);
      throw error;
    }

    // If circuit breaker is HALF_OPEN, this is a test request
    const isTestRequest = metadata?.circuitBreaker?.state === CircuitState.HALF_OPEN;

    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        // Record success
        this.recordOperationMetric(accountId, operationName, true, Date.now() - startTime);
        this.recordCircuitBreakerSuccess(accountId);

        return result;
      } catch (error) {
        lastError = error as Error;
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxDelay
        );

        console.error(`[IMAP] ${operationName} attempt ${attempt + 1}/${retryConfig.maxAttempts} failed for ${accountId}:`, lastError.message);

        if (attempt < retryConfig.maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.recordOperationMetric(accountId, operationName, false, Date.now() - startTime);
    this.recordCircuitBreakerFailure(accountId);

    throw lastError || new Error(`${operationName} failed after ${retryConfig.maxAttempts} attempts`);
  }

  /**
   * Disconnect from IMAP server
   */
  async disconnect(accountId: string): Promise<void> {
    const client = this.activeConnections.get(accountId);
    if (!client) {
      return;
    }

    try {
      await client.logout();
      this.activeConnections.delete(accountId);
      this.updateConnectionState(accountId, ConnectionState.DISCONNECTED);
      console.error(`[IMAP] Disconnected account ${accountId}`);
    } catch (error) {
      console.error(`[IMAP] Error during disconnect for ${accountId}:`, error);
      // Force remove connection
      this.activeConnections.delete(accountId);
    }
  }

  /**
   * Get active connection or throw error
   */
  private getConnection(accountId: string): ImapFlow {
    const client = this.activeConnections.get(accountId);
    if (!client) {
      throw new Error(`No active connection for account ${accountId}`);
    }
    return client;
  }

  // ==================
  // Folder Operations
  // ==================

  async listFolders(accountId: string): Promise<Folder[]> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      const list = await client.list();

      return this.parseImapFlowFolders(list);
    }, 'listFolders');
  }

  private parseImapFlowFolders(list: ListResponse[]): Folder[] {
    const folders: Folder[] = [];

    for (const item of list) {
      folders.push({
        name: item.path,
        delimiter: item.delimiter || '/',
        attributes: item.flags ? (Array.isArray(item.flags) ? item.flags : Array.from(item.flags)) : [],
        children: item.subscribed !== undefined ? [] : undefined
      });
    }

    return folders;
  }

  async selectFolder(accountId: string, folderName: string): Promise<any> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      const mailbox = await client.mailboxOpen(folderName);

      return {
        name: mailbox.path,
        messages: {
          total: mailbox.exists,
          new: 0, // ImapFlow doesn't provide this directly
          unseen: 0 // Not available in MailboxObject
        },
        uidvalidity: mailbox.uidValidity,
        uidnext: mailbox.uidNext,
        flags: mailbox.flags,
        permanentFlags: mailbox.permanentFlags
      };
    }, `selectFolder(${folderName})`);
  }

  async createFolder(accountId: string, folderName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxCreate(folderName);
    }, `createFolder(${folderName})`);
  }

  async deleteFolder(accountId: string, folderName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxDelete(folderName);
    }, `deleteFolder(${folderName})`);
  }

  async renameFolder(accountId: string, oldName: string, newName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxRename(oldName, newName);
    }, `renameFolder(${oldName} -> ${newName})`);
  }

  // RFC 9051: SUBSCRIBE/UNSUBSCRIBE commands (Issue #53)
  async subscribeMailbox(accountId: string, mailboxName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxSubscribe(mailboxName);
    }, `subscribeMailbox(${mailboxName})`);
  }

  async unsubscribeMailbox(accountId: string, mailboxName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxUnsubscribe(mailboxName);
    }, `unsubscribeMailbox(${mailboxName})`);
  }

  async listSubscribedMailboxes(accountId: string): Promise<Folder[]> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      // Use client.list() which returns all mailboxes with subscription status
      const list = await client.list();

      // Filter for subscribed mailboxes only
      const subscribedFolders = list.filter(item => item.subscribed === true);

      return this.parseImapFlowFolders(subscribedFolders);
    }, 'listSubscribedMailboxes()');
  }

  /**
   * RFC 9051: STATUS command (Issue #56)
   * Get mailbox status without selecting it (more efficient than SELECT)
   * Supports optional STATUS=SIZE and STATUS=DELETED extensions
   */
  async getMailboxStatus(accountId: string, mailboxName: string): Promise<MailboxStatus> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);

      // Check capabilities for optional STATUS extensions
      const capabilities = client.capabilities;
      const supportsStatusSize = capabilities.has('STATUS=SIZE');
      const supportsStatusDeleted = capabilities.has('STATUS=DELETED');

      // Build status query options
      const statusOptions: any = {
        messages: true,
        uidNext: true,
        uidValidity: true,
        unseen: true,
      };

      if (supportsStatusSize) {
        statusOptions.size = true;
      }

      if (supportsStatusDeleted) {
        statusOptions.deleted = true;
      }

      // Query mailbox status
      const status = await client.status(mailboxName, statusOptions);

      // Cast to any to access optional STATUS=SIZE and STATUS=DELETED extension fields
      const statusAny: any = status;

      return {
        mailbox: mailboxName,
        messages: status.messages || 0,
        uidNext: status.uidNext || 0,
        uidValidity: status.uidValidity ? BigInt(status.uidValidity) : BigInt(0),
        unseen: status.unseen || 0,
        deleted: statusAny.deleted as number | undefined,
        size: statusAny.size as number | undefined,
      };
    }, `getMailboxStatus(${mailboxName})`);
  }

  /**
   * RFC 9051: Bulk STATUS command (Issue #56)
   * Get status for multiple mailboxes efficiently
   */
  async getMultipleMailboxStatus(
    accountId: string,
    mailboxNames: string[]
  ): Promise<MailboxStatus[]> {
    return this.withRetry(accountId, async () => {
      const statuses: MailboxStatus[] = [];

      for (const mailboxName of mailboxNames) {
        try {
          const status = await this.getMailboxStatus(accountId, mailboxName);
          statuses.push(status);
        } catch (error) {
          // Skip mailboxes that can't be accessed
          console.error(`Failed to get status for ${mailboxName}:`, error);
        }
      }

      return statuses;
    }, `getMultipleMailboxStatus(${mailboxNames.length} mailboxes)`);
  }

  /**
   * Query IMAP server capabilities (Issue #55)
   * Implements capability detection as required by RFC 9051
   * Includes caching to avoid repeated queries
   */
  async getCapabilities(accountId: string, forceRefresh: boolean = false): Promise<ServerCapabilities> {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.capabilitiesCache.get(accountId);
      if (cached && (Date.now() - cached.timestamp) < 3600000) { // 1 hour cache
        return cached.capabilities;
      }
    }

    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);

      // ImapFlow provides capabilities as a Map
      const rawCapabilities = client.capabilities;
      const capArray = Array.from(rawCapabilities.keys());

      // Parse capabilities
      const capabilities: ServerCapabilities = {
        raw: capArray,
        imap4rev2: rawCapabilities.has('IMAP4rev2'),
        imap4rev1: rawCapabilities.has('IMAP4REV1') || rawCapabilities.has('IMAP4rev1'),
        authMethods: this.extractAuthMethods(capArray),
        extensions: this.parseExtensions(capArray)
      };

      // Cache the result
      this.capabilitiesCache.set(accountId, {
        capabilities,
        timestamp: Date.now()
      });

      return capabilities;
    }, 'getCapabilities');
  }

  /**
   * Extract AUTH methods from capability strings
   */
  private extractAuthMethods(capabilities: string[]): string[] {
    return capabilities
      .filter(cap => cap.startsWith('AUTH='))
      .map(cap => cap.substring(5)); // Remove "AUTH=" prefix
  }

  /**
   * Parse extension capabilities
   */
  private parseExtensions(capabilities: string[]): ServerCapabilities['extensions'] {
    const extensions: ServerCapabilities['extensions'] = {};

    // Normalize capability names for comparison (uppercase, remove special chars)
    const capSet = new Set(capabilities.map(c => c.toUpperCase().replace(/[=+-]/g, '')));

    // Core IMAP4rev2 built-in extensions
    extensions.namespace = capSet.has('NAMESPACE');
    extensions.unselect = capSet.has('UNSELECT');
    extensions.uidplus = capSet.has('UIDPLUS');
    extensions.esearch = capSet.has('ESEARCH');
    extensions.searchres = capSet.has('SEARCHRES');
    extensions.enable = capSet.has('ENABLE');
    extensions.idle = capSet.has('IDLE');
    extensions.saslir = capSet.has('SASLIR');
    extensions.listExtended = capSet.has('LISTEXTENDED');
    extensions.listStatus = capSet.has('LISTSTATUS');
    extensions.move = capSet.has('MOVE');
    extensions.literalMinus = capSet.has('LITERALMINUS') || capSet.has('LITERAL');
    extensions.binary = capSet.has('BINARY');
    extensions.specialUse = capSet.has('SPECIALUSE');
    extensions.statusSize = capabilities.some(c => c.toUpperCase().includes('STATUS') && c.toUpperCase().includes('SIZE'));
    extensions.statusDeleted = capabilities.some(c => c.toUpperCase().includes('STATUS') && c.toUpperCase().includes('DELETED'));

    // Common optional extensions
    extensions.quota = capSet.has('QUOTA');
    extensions.sort = capSet.has('SORT');
    extensions.thread = capSet.has('THREAD');
    extensions.condstore = capSet.has('CONDSTORE');
    extensions.qresync = capSet.has('QRESYNC');
    extensions.compress = capabilities.some(c => c.toUpperCase().includes('COMPRESS'));
    extensions.notify = capSet.has('NOTIFY');
    extensions.metadata = capSet.has('METADATA');

    return extensions;
  }

  // ==================
  // Email Operations
  // ==================

  async searchEmails(accountId: string, folderName: string, criteria: SearchCriteria): Promise<EmailMessage[]> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);

      // Open mailbox
      await client.mailboxOpen(folderName);

      // Build search query for ImapFlow
      const searchQuery = this.buildImapFlowSearchQuery(criteria);

      // Search
      const searchResult = await client.search(searchQuery, { uid: true });

      // ImapFlow returns false if no results
      if (!searchResult || searchResult.length === 0) {
        return [];
      }

      // Fetch message headers
      const messages: EmailMessage[] = [];

      for await (const msg of client.fetch(searchResult, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true
      }, { uid: true })) {
        messages.push({
          uid: msg.uid,
          flags: msg.flags ? Array.from(msg.flags) : [],
          from: msg.envelope?.from?.[0]?.address || '',
          to: msg.envelope?.to?.map(t => t.address || '') || [],
          subject: msg.envelope?.subject || '',
          messageId: msg.envelope?.messageId || '',
          inReplyTo: msg.envelope?.inReplyTo,
          date: msg.envelope?.date || new Date()
        });
      }

      return messages;
    }, `searchEmails(${folderName})`);
  }

  private buildImapFlowSearchQuery(criteria: SearchCriteria): any {
    const query: any = {};

    if (criteria.from) query.from = criteria.from;
    if (criteria.to) query.to = criteria.to;
    if (criteria.subject) query.subject = criteria.subject;
    if (criteria.body) query.body = criteria.body;
    if (criteria.since) query.since = criteria.since;
    if (criteria.before) query.before = criteria.before;
    if (criteria.seen !== undefined) {
      query[criteria.seen ? 'seen' : 'unseen'] = true;
    }
    if (criteria.flagged !== undefined) {
      query[criteria.flagged ? 'flagged' : 'unflagged'] = true;
    }

    // If no criteria, return all
    return Object.keys(query).length > 0 ? query : { all: true };
  }

  async getEmailContent(accountId: string, folderName: string, uid: number, headersOnly: boolean = false): Promise<EmailContent> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);

      await client.mailboxOpen(folderName);

      if (headersOnly) {
        // Fetch only headers (envelope + flags) without message body
        const message = await client.fetchOne(uid.toString(), {
          uid: true,
          flags: true,
          envelope: true
        }, { uid: true });

        if (!message || !message.envelope) {
          throw new Error(`Email with UID ${uid} not found`);
        }

        return {
          uid,
          flags: message.flags ? Array.from(message.flags) : [],
          from: message.envelope.from?.[0]?.address || '',
          to: message.envelope.to?.map(t => t.address || '') || [],
          subject: message.envelope.subject || '',
          messageId: message.envelope.messageId || '',
          inReplyTo: message.envelope.inReplyTo,
          date: message.envelope.date || new Date(),
          textContent: '',
          htmlContent: '',
          attachments: []
        };
      }

      // Fetch email with body
      const message = await client.fetchOne(uid.toString(), {
        uid: true,
        flags: true,
        envelope: true,
        source: true
      }, { uid: true });

      if (!message || !message.source) {
        throw new Error(`Email with UID ${uid} not found`);
      }

      // Parse email body
      const parsed = await simpleParser(message.source as Buffer);

      const parsedFrom = parsed.from;
      const fromText = parsedFrom && 'value' in parsedFrom && Array.isArray(parsedFrom.value)
        ? parsedFrom.value[0]?.address || ''
        : (parsedFrom && 'text' in parsedFrom ? parsedFrom.text : '') || '';

      const parsedTo = parsed.to;
      const toText = parsedTo && 'value' in parsedTo && Array.isArray(parsedTo.value)
        ? parsedTo.value.map((t: any) => t.address || '')
        : (parsedTo && 'text' in parsedTo && parsedTo.text ? [parsedTo.text] : []);

      return {
        uid,
        flags: message.flags ? Array.from(message.flags) : [],
        from: fromText,
        to: toText,
        subject: parsed.subject || '',
        messageId: parsed.messageId || '',
        inReplyTo: parsed.inReplyTo,
        date: parsed.date || new Date(),
        textContent: parsed.text || '',
        htmlContent: parsed.html || '',
        attachments: parsed.attachments?.map((att: any) => ({
          filename: att.filename || 'unnamed',
          contentType: att.contentType,
          size: att.size
        })) || []
      };
    }, `getEmailContent(${folderName}, ${uid})`);
  }

  // ==================
  // Bulk Operations
  // ==================

  async bulkGetEmails(
    accountId: string,
    folderName: string,
    uids: number[],
    fields: BulkFetchFields = 'headers'
  ): Promise<EmailMessage[] | EmailContent[]> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(folderName);

      const results: any[] = [];

      if (fields === 'headers') {
        for await (const msg of client.fetch(uids.join(','), {
          uid: true,
          flags: true,
          envelope: true
        }, { uid: true })) {
          results.push({
            uid: msg.uid,
            flags: msg.flags ? Array.from(msg.flags) : [],
            from: msg.envelope?.from?.[0]?.address || '',
            to: msg.envelope?.to?.map(t => t.address || '') || [],
            subject: msg.envelope?.subject || '',
            messageId: msg.envelope?.messageId || '',
            inReplyTo: msg.envelope?.inReplyTo,
            date: msg.envelope?.date || new Date()
          });
        }
      } else {
        for await (const msg of client.fetch(uids.join(','), {
          uid: true,
          flags: true,
          envelope: true,
          source: fields === 'full'
        }, { uid: true })) {
          if (fields === 'full' && msg.source) {
            const parsed = await simpleParser(msg.source as Buffer);
            const parsedFrom = parsed.from;
            const fromText = parsedFrom && 'value' in parsedFrom && Array.isArray(parsedFrom.value)
              ? parsedFrom.value[0]?.address || ''
              : (parsedFrom && 'text' in parsedFrom ? parsedFrom.text : '') || '';
            const parsedTo = parsed.to;
            const toText = parsedTo && 'value' in parsedTo && Array.isArray(parsedTo.value)
              ? parsedTo.value.map((t: any) => t.address || '')
              : (parsedTo && 'text' in parsedTo && parsedTo.text ? [parsedTo.text] : []);

            results.push({
              uid: msg.uid,
              flags: msg.flags ? Array.from(msg.flags) : [],
              from: fromText,
              to: toText,
              subject: parsed.subject || '',
              messageId: parsed.messageId || '',
              inReplyTo: parsed.inReplyTo,
              date: parsed.date || new Date(),
              textContent: parsed.text || '',
              htmlContent: parsed.html || ''
            });
          } else {
            results.push({
              uid: msg.uid,
              flags: msg.flags ? Array.from(msg.flags) : [],
              from: msg.envelope?.from?.[0]?.address || '',
              to: msg.envelope?.to?.map(t => t.address || '') || [],
              subject: msg.envelope?.subject || '',
              messageId: msg.envelope?.messageId || '',
              inReplyTo: msg.envelope?.inReplyTo,
              date: msg.envelope?.date || new Date()
            });
          }
        }
      }

      return results;
    }, `bulkGetEmails(${folderName}, ${uids.length} messages)`);
  }

  async bulkMarkEmails(
    accountId: string,
    folderName: string,
    uids: number[],
    action: BulkMarkOperation
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(folderName);

      const flags = ['\\Seen'];

      switch (action) {
        case 'read':
          await client.messageFlagsAdd(uids.join(','), flags, { uid: true });
          break;
        case 'unread':
          await client.messageFlagsRemove(uids.join(','), flags, { uid: true });
          break;
        case 'flagged':
          await client.messageFlagsAdd(uids.join(','), ['\\Flagged'], { uid: true });
          break;
        case 'unflagged':
          await client.messageFlagsRemove(uids.join(','), ['\\Flagged'], { uid: true });
          break;
        case 'answered':
          await client.messageFlagsAdd(uids.join(','), ['\\Answered'], { uid: true });
          break;
        case 'unanswered':
          await client.messageFlagsRemove(uids.join(','), ['\\Answered'], { uid: true });
          break;
        case 'draft':
          await client.messageFlagsAdd(uids.join(','), ['\\Draft'], { uid: true });
          break;
        case 'not-draft':
          await client.messageFlagsRemove(uids.join(','), ['\\Draft'], { uid: true });
          break;
        case 'deleted':
          await client.messageFlagsAdd(uids.join(','), ['\\Deleted'], { uid: true });
          break;
        case 'undeleted':
          await client.messageFlagsRemove(uids.join(','), ['\\Deleted'], { uid: true });
          break;
      }
    }, `bulkMarkEmails(${folderName}, ${action}, ${uids.length} messages)`);
  }

  async markAsRead(accountId: string, folderName: string, uid: number): Promise<void> {
    await this.bulkMarkEmails(accountId, folderName, [uid], 'read');
  }

  async markAsUnread(accountId: string, folderName: string, uid: number): Promise<void> {
    await this.bulkMarkEmails(accountId, folderName, [uid], 'unread');
  }

  // RFC 9051: Keyword support (Issue #54)
  async bulkAddKeyword(
    accountId: string,
    folderName: string,
    uids: number[],
    keyword: string
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(folderName);
      await client.messageFlagsAdd(uids.join(','), [keyword], { uid: true });
    }, `bulkAddKeyword(${folderName}, ${keyword}, ${uids.length} messages)`);
  }

  async bulkRemoveKeyword(
    accountId: string,
    folderName: string,
    uids: number[],
    keyword: string
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(folderName);
      await client.messageFlagsRemove(uids.join(','), [keyword], { uid: true });
    }, `bulkRemoveKeyword(${folderName}, ${keyword}, ${uids.length} messages)`);
  }

  // RFC 9051: APPEND command (Issue #52)
  async appendMessage(
    accountId: string,
    mailboxName: string,
    messageContent: string,
    options?: { flags?: string[]; internalDate?: Date }
  ): Promise<{ uid: number; uidValidity: bigint }> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);

      const appendOptions: any = {};
      if (options?.flags) {
        appendOptions.flags = options.flags;
      }
      if (options?.internalDate) {
        appendOptions.internalDate = options.internalDate;
      }

      const result = await client.append(mailboxName, messageContent, appendOptions);

      // Handle false return (failed append) or successful AppendResponseObject
      if (!result) {
        throw new Error('APPEND command failed');
      }

      return {
        uid: Number(result.uid),
        uidValidity: result.uidValidity ? BigInt(result.uidValidity) : BigInt(0),
      };
    }, `appendMessage(${mailboxName})`);
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    await this.bulkDeleteEmails(accountId, folderName, [uid], true);
  }

  async bulkDeleteEmails(
    accountId: string,
    folderName: string,
    uids: number[],
    expunge: boolean = false
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(folderName);

      // Mark as deleted
      await client.messageFlagsAdd(uids.join(','), ['\\Deleted'], { uid: true });

      // Expunge if requested
      if (expunge) {
        await client.messageDelete(uids.join(','), { uid: true });
      }
    }, `bulkDeleteEmails(${folderName}, ${uids.length} messages)`);
  }

  // ==================
  // Copy/Move Operations
  // ==================

  async bulkCopyEmails(
    accountId: string,
    sourceFolder: string,
    uids: number[],
    targetFolder: string
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(sourceFolder);

      await client.messageCopy(uids.join(','), targetFolder, { uid: true });
    }, `bulkCopyEmails(${sourceFolder} -> ${targetFolder}, ${uids.length} messages)`);
  }

  async bulkMoveEmails(
    accountId: string,
    sourceFolder: string,
    uids: number[],
    targetFolder: string
  ): Promise<void> {
    return this.withRetry(accountId, async () => {
      const client = this.getConnection(accountId);
      await client.mailboxOpen(sourceFolder);

      await client.messageMove(uids.join(','), targetFolder, { uid: true });
    }, `bulkMoveEmails(${sourceFolder} -> ${targetFolder}, ${uids.length} messages)`);
  }

  async copyEmail(accountId: string, sourceFolder: string, uid: number, targetFolder: string): Promise<void> {
    await this.bulkCopyEmails(accountId, sourceFolder, [uid], targetFolder);
  }

  async moveEmail(accountId: string, sourceFolder: string, uid: number, targetFolder: string): Promise<void> {
    await this.bulkMoveEmails(accountId, sourceFolder, [uid], targetFolder);
  }

  // ==================
  // Connection State Management
  // ==================

  private updateConnectionState(accountId: string, state: ConnectionState): void {
    let metadata = this.connectionMetadata.get(accountId);
    if (!metadata) {
      metadata = this.initializeMetadata(accountId);
    }
    metadata.state = state;
    this.connectionMetadata.set(accountId, metadata);
  }

  private initializeMetadata(accountId: string): ConnectionMetadata {
    const metadata: ConnectionMetadata = {
      state: ConnectionState.DISCONNECTED,
      reconnectAttempts: 0,
      circuitBreaker: this.initializeCircuitBreaker(accountId),
      metrics: this.initializeMetrics()
    };
    this.connectionMetadata.set(accountId, metadata);
    return metadata;
  }

  // ==================
  // Level 3: Circuit Breaker
  // ==================

  private initializeCircuitBreaker(accountId: string): CircuitBreakerState {
    const account = this.accountStore.get(accountId);
    const config = this.getCircuitBreakerConfig(account?.circuitBreaker);

    return {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: undefined,
      lastStateChange: new Date(),
      config
    };
  }

  private recordCircuitBreakerFailure(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.circuitBreaker) return;

    const cb = metadata.circuitBreaker;
    cb.failureCount++;
    cb.lastFailureTime = new Date();
    cb.successCount = 0;

    if (cb.state === CircuitState.CLOSED && cb.failureCount >= cb.config.failureThreshold) {
      cb.state = CircuitState.OPEN;
      cb.lastStateChange = new Date();
      console.error(`[CircuitBreaker] OPENED for account ${accountId} (${cb.failureCount} failures)`);

      // Schedule transition to HALF_OPEN
      setTimeout(() => {
        if (cb.state === CircuitState.OPEN) {
          cb.state = CircuitState.HALF_OPEN;
          cb.lastStateChange = new Date();
          console.error(`[CircuitBreaker] Transitioned to HALF_OPEN for account ${accountId}`);
        }
      }, cb.config.timeout);
    }
  }

  private recordCircuitBreakerSuccess(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.circuitBreaker) return;

    const cb = metadata.circuitBreaker;
    cb.successCount++;
    cb.failureCount = 0;

    if (cb.state === CircuitState.HALF_OPEN && cb.successCount >= cb.config.successThreshold) {
      cb.state = CircuitState.CLOSED;
      cb.lastStateChange = new Date();
      console.error(`[CircuitBreaker] CLOSED for account ${accountId} (${cb.successCount} successes)`);
    }
  }

  // ==================
  // Level 3: Metrics
  // ==================

  private initializeMetrics(): ConnectionMetrics {
    return {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageLatency: 0,
      uptime: 0,
      lastOperationTime: new Date()
    };
  }

  private recordOperationMetric(accountId: string, operation: string, success: boolean, latency: number): void {
    // Update connection metrics
    const metadata = this.connectionMetadata.get(accountId);
    if (metadata?.metrics) {
      metadata.metrics.totalOperations++;
      if (success) {
        metadata.metrics.successfulOperations++;
      } else {
        metadata.metrics.failedOperations++;
      }
      metadata.metrics.averageLatency =
        (metadata.metrics.averageLatency * (metadata.metrics.totalOperations - 1) + latency) /
        metadata.metrics.totalOperations;
      metadata.metrics.lastOperationTime = new Date();
    }

    // Update operation-specific metrics
    const key = `${accountId}:${operation}`;
    let opMetric = this.operationMetrics.get(key);
    if (!opMetric) {
      opMetric = {
        operationName: operation,
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        averageLatency: 0,
        minLatency: Infinity,
        maxLatency: 0
      };
      this.operationMetrics.set(key, opMetric);
    }

    opMetric.count++;
    opMetric.totalLatency += latency;
    if (success) {
      opMetric.successCount++;
    } else {
      opMetric.failureCount++;
    }
    opMetric.averageLatency = (opMetric.averageLatency * (opMetric.count - 1) + latency) / opMetric.count;
    opMetric.minLatency = Math.min(opMetric.minLatency, latency);
    opMetric.maxLatency = Math.max(opMetric.maxLatency, latency);
  }

  async getMetrics(accountId: string): Promise<ConnectionMetrics | null> {
    const metadata = this.connectionMetadata.get(accountId);
    return metadata?.metrics || null;
  }

  getOperationMetrics(accountId: string, operation?: string): OperationMetrics[] {
    if (operation) {
      const key = `${accountId}:${operation}`;
      const metric = this.operationMetrics.get(key);
      return metric ? [metric] : [];
    }

    // Return all metrics for this account
    const metrics: OperationMetrics[] = [];
    for (const [key, metric] of this.operationMetrics.entries()) {
      if (key.startsWith(`${accountId}:`)) {
        metrics.push(metric);
      }
    }
    return metrics;
  }

  resetMetrics(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (metadata) {
      metadata.metrics = this.initializeMetrics();
    }

    // Clear operation metrics
    for (const key of this.operationMetrics.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        this.operationMetrics.delete(key);
      }
    }
  }

  // ==================
  // Configuration Helpers
  // ==================

  private getRetryConfig(retry?: RetryConfig): Required<RetryConfig> {
    return {
      maxAttempts: retry?.maxAttempts || 5,
      initialDelay: retry?.initialDelay || 1000,
      maxDelay: retry?.maxDelay || 60000,
      backoffMultiplier: retry?.backoffMultiplier || 2
    };
  }

  private getCircuitBreakerConfig(config?: CircuitBreakerConfig): Required<CircuitBreakerConfig> {
    return {
      failureThreshold: config?.failureThreshold || 5,
      successThreshold: config?.successThreshold || 2,
      timeout: config?.timeout || 60000,
      monitoringWindow: config?.monitoringWindow || 120000
    };
  }
}

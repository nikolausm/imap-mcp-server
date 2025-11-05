import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import {
  ImapAccount,
  EmailMessage,
  EmailContent,
  Folder,
  SearchCriteria,
  ConnectionPool,
  KeepAliveConfig,
  RetryConfig,
  ConnectionState,
  ConnectionMetadata,
  BulkMarkOperation,
  BulkFetchFields,
  BulkOperationResult,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerState,
  QueuedOperation,
  OperationQueueConfig,
  ConnectionMetrics,
  OperationMetrics,
  DegradationConfig
} from '../types/index.js';

export class ImapService {
  private connectionPool: ConnectionPool = {};
  private activeConnections: Map<string, Imap> = new Map();
  private connectionMetadata: Map<string, ConnectionMetadata> = new Map();
  private accountStore: Map<string, ImapAccount> = new Map();

  // Level 3: Operation queue
  private operationQueue: QueuedOperation[] = [];
  private queueProcessorInterval?: NodeJS.Timeout;
  private operationMetrics: Map<string, OperationMetrics> = new Map();

  // Level 2: Connection with state tracking and auto-reconnect
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

    // Build keepalive configuration
    const keepaliveConfig = this.buildKeepAliveConfig(account.keepalive);

    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: account.host,
      port: account.port,
      tls: account.tls,
      authTimeout: account.authTimeout || 3000,
      connTimeout: account.connTimeout || 10000,
      keepalive: keepaliveConfig,
    });

    // Set up connection monitoring
    this.setupConnectionMonitoring(imap, account);

    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        this.activeConnections.set(accountId, imap);
        this.updateConnectionState(accountId, ConnectionState.CONNECTED);

        const metadata = this.connectionMetadata.get(accountId);
        if (metadata) {
          metadata.lastConnected = new Date();
          metadata.reconnectAttempts = 0;
        }

        // Start health check
        this.startHealthCheck(accountId);

        console.error(`[IMAP] Connection established for account ${accountId}`);
        resolve();
      });

      imap.once('error', (err: Error) => {
        console.error(`[IMAP] Connection error for account ${accountId}:`, err.message);
        this.updateConnectionState(accountId, ConnectionState.ERROR);
        reject(err);
      });

      imap.connect();
    });
  }

  // Level 2: Automatic reconnection with exponential backoff
  private async reconnect(accountId: string): Promise<void> {
    const account = this.accountStore.get(accountId);
    if (!account) {
      console.error(`[IMAP] Cannot reconnect: account ${accountId} not found`);
      return;
    }

    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata) return;

    const retryConfig = this.getRetryConfig(account.retry);

    if (metadata.reconnectAttempts >= retryConfig.maxAttempts) {
      console.error(`[IMAP] Max reconnection attempts reached for account ${accountId}`);
      this.updateConnectionState(accountId, ConnectionState.ERROR);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, metadata.reconnectAttempts),
      retryConfig.maxDelay
    );

    metadata.reconnectAttempts++;

    console.error(`[IMAP] Reconnecting to account ${accountId} (attempt ${metadata.reconnectAttempts}/${retryConfig.maxAttempts}) in ${delay}ms`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect(account, true);
      console.error(`[IMAP] Reconnection successful for account ${accountId}`);
    } catch (error) {
      console.error(`[IMAP] Reconnection failed for account ${accountId}:`, error);
      // Try again
      await this.reconnect(accountId);
    }
  }

  // Level 2: Health check with periodic NOOP
  private startHealthCheck(accountId: string): void {
    this.stopHealthCheck(accountId);

    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata) return;

    // Send NOOP every 29 minutes (per RFC 2177)
    const interval = setInterval(async () => {
      try {
        await this.sendNoop(accountId);
        console.error(`[IMAP] Health check NOOP sent for account ${accountId}`);
      } catch (error) {
        console.error(`[IMAP] Health check failed for account ${accountId}:`, error);
        this.stopHealthCheck(accountId);
        await this.reconnect(accountId);
      }
    }, 29 * 60 * 1000); // 29 minutes

    metadata.healthCheckInterval = interval;
  }

  private stopHealthCheck(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (metadata?.healthCheckInterval) {
      clearInterval(metadata.healthCheckInterval);
      metadata.healthCheckInterval = undefined;
    }
  }

  private async sendNoop(accountId: string): Promise<void> {
    const connection = this.getConnection(accountId);
    return new Promise((resolve, reject) => {
      (connection as any).send('NOOP', (err: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Level 2+3: Retry wrapper for operations with circuit breaker and metrics
  private async withRetry<T>(
    accountId: string,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Level 3: Check circuit breaker before attempting
    if (!this.checkCircuitBreaker(accountId)) {
      this.recordCircuitFailure(accountId);
      throw new Error(`Circuit breaker OPEN for ${accountId}, operation rejected`);
    }

    const account = this.accountStore.get(accountId);
    const retryConfig = this.getRetryConfig(account?.retry);

    let lastError: Error | undefined;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        // Level 3: Record success metrics
        const latency = Date.now() - startTime;
        this.recordOperationMetrics(operationName, latency, true, accountId);
        this.recordCircuitSuccess(accountId);
        this.exitDegradationMode(accountId);

        return result;
      } catch (error) {
        lastError = error as Error;
        console.error(`[IMAP] ${operationName} failed (attempt ${attempt + 1}/${retryConfig.maxAttempts + 1}):`, error);

        // Level 3: Record failure
        this.recordCircuitFailure(accountId);
        this.enterDegradationMode(accountId);

        if (attempt < retryConfig.maxAttempts) {
          // Check if it's a connection error
          if (this.isConnectionError(error as Error)) {
            console.error(`[IMAP] Connection error detected, attempting reconnection...`);
            await this.reconnect(accountId);
          } else {
            // Wait before retry
            const delay = Math.min(
              retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt),
              retryConfig.maxDelay
            );
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    }

    // Level 3: Record final failure metrics
    const latency = Date.now() - startTime;
    this.recordOperationMetrics(operationName, latency, false, accountId);

    throw lastError || new Error(`${operationName} failed after ${retryConfig.maxAttempts} attempts`);
  }

  private isConnectionError(error: Error): boolean {
    const connectionErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'connection',
      'timeout',
      'socket',
      'closed'
    ];

    const errorMessage = error.message.toLowerCase();
    return connectionErrors.some(msg => errorMessage.includes(msg));
  }

  async disconnect(accountId: string): Promise<void> {
    this.stopHealthCheck(accountId);

    const connection = this.activeConnections.get(accountId);
    if (connection) {
      connection.end();
      this.activeConnections.delete(accountId);
    }

    this.updateConnectionState(accountId, ConnectionState.DISCONNECTED);
    console.error(`[IMAP] Disconnected from account ${accountId}`);
  }

  // Connection state management
  private updateConnectionState(accountId: string, state: ConnectionState): void {
    let metadata = this.connectionMetadata.get(accountId);
    if (!metadata) {
      metadata = {
        state,
        reconnectAttempts: 0,
        // Level 3: Initialize circuit breaker
        circuitBreaker: {
          state: CircuitState.CLOSED,
          failures: 0,
          successes: 0,
          failureTimestamps: []
        },
        // Level 3: Initialize metrics
        metrics: {
          totalOperations: 0,
          successfulOperations: 0,
          failedOperations: 0,
          averageLatency: 0,
          uptimePercentage: 100,
          connectionUptime: 0,
          totalDowntime: 0,
          lastMetricsReset: new Date()
        },
        // Level 3: Initialize cache
        cacheData: new Map()
      };
      this.connectionMetadata.set(accountId, metadata);
    } else {
      metadata.state = state;
    }
  }

  private setupConnectionMonitoring(imap: Imap, account: ImapAccount): void {
    const accountId = account.id;

    imap.on('error', (err: Error) => {
      console.error(`[IMAP] Error on connection ${accountId}:`, err.message);
      this.activeConnections.delete(accountId);
      this.updateConnectionState(accountId, ConnectionState.ERROR);
      this.stopHealthCheck(accountId);

      const metadata = this.connectionMetadata.get(accountId);
      if (metadata) {
        metadata.lastError = err;
      }

      // Auto-reconnect
      this.reconnect(accountId);
    });

    imap.on('end', () => {
      console.error(`[IMAP] Connection ended for account ${accountId}`);
      this.activeConnections.delete(accountId);
      this.updateConnectionState(accountId, ConnectionState.DISCONNECTED);
      this.stopHealthCheck(accountId);

      // Auto-reconnect
      this.reconnect(accountId);
    });

    imap.on('close', (hadError: boolean) => {
      console.error(`[IMAP] Connection closed for account ${accountId}, hadError: ${hadError}`);
      this.activeConnections.delete(accountId);
      this.updateConnectionState(accountId, ConnectionState.DISCONNECTED);
      this.stopHealthCheck(accountId);

      if (hadError) {
        // Auto-reconnect on error
        this.reconnect(accountId);
      }
    });
  }

  private buildKeepAliveConfig(keepalive?: boolean | KeepAliveConfig): boolean | KeepAliveConfig {
    if (keepalive === false) {
      return false;
    }

    if (typeof keepalive === 'object') {
      return {
        interval: keepalive.interval || 10000,
        idleInterval: keepalive.idleInterval || 1740000,
        forceNoop: keepalive.forceNoop !== false,
      };
    }

    return {
      interval: 10000,
      idleInterval: 1740000,
      forceNoop: true,
    };
  }

  private getRetryConfig(retry?: RetryConfig): Required<RetryConfig> {
    return {
      maxAttempts: retry?.maxAttempts || 5,
      initialDelay: retry?.initialDelay || 1000,
      maxDelay: retry?.maxDelay || 60000,
      backoffMultiplier: retry?.backoffMultiplier || 2,
    };
  }

  // Existing operations with retry wrapper
  async listFolders(accountId: string): Promise<Folder[]> {
    return this.withRetry(accountId, async () => {
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        connection.getBoxes((err: Error | null, boxes: any) => {
          if (err) {
            reject(err);
            return;
          }

          const folders = this.parseBoxes(boxes);
          resolve(folders);
        });
      });
    }, 'listFolders');
  }

  async selectFolder(accountId: string, folderName: string): Promise<any> {
    return this.withRetry(accountId, async () => {
      const connection = this.getConnection(accountId);
      return new Promise((resolve, reject) => {
        connection.openBox(folderName, false, (err: Error | null, box: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(box);
          }
        });
      });
    }, `selectFolder(${folderName})`);
  }

  async createFolder(accountId: string, folderName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const connection = this.getConnection(accountId);
      return new Promise<void>((resolve, reject) => {
        connection.addBox(folderName, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }, `createFolder(${folderName})`);
  }

  async deleteFolder(accountId: string, folderName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const connection = this.getConnection(accountId);
      return new Promise<void>((resolve, reject) => {
        connection.delBox(folderName, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }, `deleteFolder(${folderName})`);
  }

  async renameFolder(accountId: string, oldName: string, newName: string): Promise<void> {
    return this.withRetry(accountId, async () => {
      const connection = this.getConnection(accountId);
      return new Promise<void>((resolve, reject) => {
        connection.renameBox(oldName, newName, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }, `renameFolder(${oldName} -> ${newName})`);
  }

  async searchEmails(accountId: string, folderName: string, criteria: SearchCriteria): Promise<EmailMessage[]> {
    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      const searchCriteria = this.buildSearchCriteria(criteria);

      return new Promise((resolve, reject) => {
        connection.search(searchCriteria, (err: Error, uids: number[]) => {
          if (err) {
            reject(err);
            return;
          }

          if (uids.length === 0) {
            resolve([]);
            return;
          }

          const messages: EmailMessage[] = [];
          const fetch = connection.fetch(uids, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO)',
            struct: true,
          });

          fetch.on('message', (msg: any, seqno: number) => {
            let header = '';
            let uid: number;

            msg.on('body', (stream: any) => {
              stream.on('data', (chunk: Buffer) => {
                header += chunk.toString('utf8');
              });
            });

            msg.once('attributes', (attrs: any) => {
              uid = attrs.uid;
            });

            msg.once('end', () => {
              const parsedHeader = Imap.parseHeader(header);
              messages.push({
                uid,
                date: new Date(parsedHeader.date?.[0] || Date.now()),
                from: parsedHeader.from?.[0] || '',
                to: parsedHeader.to || [],
                subject: parsedHeader.subject?.[0] || '',
                messageId: parsedHeader['message-id']?.[0] || '',
                inReplyTo: parsedHeader['in-reply-to']?.[0],
                flags: [],
              });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => resolve(messages));
        });
      });
    }, 'searchEmails');
  }

  async getEmailContent(accountId: string, folderName: string, uid: number): Promise<EmailContent> {
    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        const fetch = connection.fetch(uid, {
          bodies: '',
          struct: true,
        });

        fetch.on('message', (msg: any) => {
          let buffer = '';

          msg.on('body', (stream: any) => {
            stream.on('data', (chunk: Buffer) => {
              buffer += chunk.toString('utf8');
            });

            stream.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const emailContent: EmailContent = {
                  uid,
                  date: parsed.date || new Date(),
                  from: parsed.from?.text || '',
                  to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text || '') : [parsed.to.text || '']) : [],
                  subject: parsed.subject || '',
                  messageId: parsed.messageId || '',
                  inReplyTo: parsed.inReplyTo as string | undefined,
                  flags: [],
                  textContent: parsed.text,
                  htmlContent: parsed.html || undefined,
                  attachments: parsed.attachments?.map((att: any) => ({
                    filename: att.filename || 'unknown',
                    contentType: att.contentType || 'application/octet-stream',
                    size: att.size || 0,
                    contentId: att.contentId,
                  })) || [],
                };
                resolve(emailContent);
              } catch (error) {
                reject(error);
              }
            });
          });

          msg.once('error', reject);
        });

        fetch.once('error', reject);
      });
    }, `getEmailContent(uid:${uid})`);
  }

  // Level 2: Bulk read emails
  async bulkGetEmails(
    accountId: string,
    folderName: string,
    uids: number[],
    fields: BulkFetchFields = 'headers'
  ): Promise<EmailContent[]> {
    if (uids.length === 0) {
      return [];
    }

    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      const fetchConfig = fields === 'headers'
        ? { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO)', struct: true }
        : { bodies: '', struct: true };

      return new Promise((resolve, reject) => {
        const emails: EmailContent[] = [];
        const fetch = connection.fetch(uids, fetchConfig);

        fetch.on('message', (msg: any) => {
          let buffer = '';
          let uid: number;

          msg.on('body', (stream: any) => {
            stream.on('data', (chunk: Buffer) => {
              buffer += chunk.toString('utf8');
            });
          });

          msg.once('attributes', (attrs: any) => {
            uid = attrs.uid;
          });

          msg.once('end', async () => {
            try {
              if (fields === 'headers') {
                const parsedHeader = Imap.parseHeader(buffer);
                emails.push({
                  uid,
                  date: new Date(parsedHeader.date?.[0] || Date.now()),
                  from: parsedHeader.from?.[0] || '',
                  to: parsedHeader.to || [],
                  subject: parsedHeader.subject?.[0] || '',
                  messageId: parsedHeader['message-id']?.[0] || '',
                  inReplyTo: parsedHeader['in-reply-to']?.[0],
                  flags: [],
                  attachments: [],
                });
              } else {
                const parsed = await simpleParser(buffer);
                emails.push({
                  uid,
                  date: parsed.date || new Date(),
                  from: parsed.from?.text || '',
                  to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text || '') : [parsed.to.text || '']) : [],
                  subject: parsed.subject || '',
                  messageId: parsed.messageId || '',
                  inReplyTo: parsed.inReplyTo as string | undefined,
                  flags: [],
                  textContent: fields === 'full' || fields === 'body' ? parsed.text : undefined,
                  htmlContent: fields === 'full' ? (parsed.html || undefined) : undefined,
                  attachments: fields === 'full' ? (parsed.attachments?.map((att: any) => ({
                    filename: att.filename || 'unknown',
                    contentType: att.contentType || 'application/octet-stream',
                    size: att.size || 0,
                    contentId: att.contentId,
                  })) || []) : [],
                });
              }
            } catch (error) {
              console.error(`[IMAP] Error parsing email uid ${uid}:`, error);
            }
          });
        });

        fetch.once('error', reject);
        fetch.once('end', () => resolve(emails));
      });
    }, `bulkGetEmails(${uids.length} emails)`);
  }

  // Level 2: Bulk mark operations
  async bulkMarkEmails(
    accountId: string,
    folderName: string,
    uids: number[],
    operation: BulkMarkOperation
  ): Promise<BulkOperationResult> {
    if (uids.length === 0) {
      return { success: true, processedCount: 0, failedCount: 0 };
    }

    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      const flagMap: Record<BulkMarkOperation, { flag: string; add: boolean }> = {
        'read': { flag: '\\Seen', add: true },
        'unread': { flag: '\\Seen', add: false },
        'flagged': { flag: '\\Flagged', add: true },
        'unflagged': { flag: '\\Flagged', add: false },
      };

      const { flag, add } = flagMap[operation];

      return new Promise<BulkOperationResult>((resolve, reject) => {
        const action = add ? connection.addFlags.bind(connection) : connection.delFlags.bind(connection);

        action(uids, flag, (err: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve({
              success: true,
              processedCount: uids.length,
              failedCount: 0,
            });
          }
        });
      });
    }, `bulkMarkEmails(${operation}, ${uids.length} emails)`);
  }

  async markAsRead(accountId: string, folderName: string, uid: number): Promise<void> {
    // Refactored to call bulk operation internally (Issue #4)
    await this.bulkMarkEmails(accountId, folderName, [uid], 'read');
  }

  async markAsUnread(accountId: string, folderName: string, uid: number): Promise<void> {
    // Refactored to call bulk operation internally (Issue #4)
    await this.bulkMarkEmails(accountId, folderName, [uid], 'unread');
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    // Refactored to call bulk operation internally (Issue #4)
    // Note: Always expunges to maintain original behavior
    await this.bulkDeleteEmails(accountId, folderName, [uid], true);
  }

  // Level 2: Bulk delete (from previous PR)
  async bulkDeleteEmails(accountId: string, folderName: string, uids: number[], expunge: boolean = false): Promise<void> {
    if (uids.length === 0) {
      return;
    }

    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        connection.addFlags(uids, '\\Deleted', (err: Error) => {
          if (err) {
            reject(err);
            return;
          }

          if (expunge) {
            connection.expunge((err: Error) => {
              if (err) reject(err);
              else resolve();
            });
          } else {
            resolve();
          }
        });
      });
    }, `bulkDeleteEmails(${uids.length} emails)`);
  }

  // Issue #4: Bulk copy emails
  async bulkCopyEmails(
    accountId: string,
    sourceFolder: string,
    uids: number[],
    targetFolder: string
  ): Promise<BulkOperationResult> {
    if (uids.length === 0) {
      return { success: true, processedCount: 0, failedCount: 0 };
    }

    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, sourceFolder);
      const connection = this.getConnection(accountId);

      return new Promise<BulkOperationResult>((resolve, reject) => {
        connection.copy(uids, targetFolder, (err: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve({
              success: true,
              processedCount: uids.length,
              failedCount: 0,
            });
          }
        });
      });
    }, `bulkCopyEmails(${uids.length} emails to ${targetFolder})`);
  }

  // Issue #4: Bulk move emails (copy + delete)
  async bulkMoveEmails(
    accountId: string,
    sourceFolder: string,
    uids: number[],
    targetFolder: string
  ): Promise<BulkOperationResult> {
    if (uids.length === 0) {
      return { success: true, processedCount: 0, failedCount: 0 };
    }

    return this.withRetry(accountId, async () => {
      // First copy to target folder
      await this.bulkCopyEmails(accountId, sourceFolder, uids, targetFolder);

      // Then mark as deleted (but don't expunge yet)
      await this.bulkDeleteEmails(accountId, sourceFolder, uids, false);

      // Return success result
      return {
        success: true,
        processedCount: uids.length,
        failedCount: 0,
      };
    }, `bulkMoveEmails(${uids.length} emails to ${targetFolder})`);
  }

  // Issue #4: Single operation wrappers for copy/move
  async copyEmail(accountId: string, sourceFolder: string, uid: number, targetFolder: string): Promise<void> {
    await this.bulkCopyEmails(accountId, sourceFolder, [uid], targetFolder);
  }

  async moveEmail(accountId: string, sourceFolder: string, uid: number, targetFolder: string): Promise<void> {
    await this.bulkMoveEmails(accountId, sourceFolder, [uid], targetFolder);
  }

  private getConnection(accountId: string): Imap {
    const connection = this.activeConnections.get(accountId);
    if (!connection) {
      throw new Error(`No active connection for account ${accountId}`);
    }
    return connection;
  }

  private parseBoxes(boxes: any, parentPath = ''): Folder[] {
    const folders: Folder[] = [];

    for (const [name, box] of Object.entries(boxes)) {
      const boxData = box as any;
      const folder: Folder = {
        name: parentPath ? `${parentPath}${boxData.delimiter}${name}` : name,
        delimiter: boxData.delimiter,
        attributes: boxData.attribs || [],
      };

      if (boxData.children) {
        folder.children = this.parseBoxes(boxData.children, folder.name);
      }

      folders.push(folder);
    }

    return folders;
  }

  private buildSearchCriteria(criteria: SearchCriteria): any[] {
    const searchArray: any[] = [];

    if (criteria.from) {
      searchArray.push(['FROM', criteria.from]);
    }
    if (criteria.to) {
      searchArray.push(['TO', criteria.to]);
    }
    if (criteria.subject) {
      searchArray.push(['SUBJECT', criteria.subject]);
    }
    if (criteria.body) {
      searchArray.push(['BODY', criteria.body]);
    }
    if (criteria.since) {
      searchArray.push(['SINCE', criteria.since]);
    }
    if (criteria.before) {
      searchArray.push(['BEFORE', criteria.before]);
    }
    if (criteria.seen !== undefined) {
      searchArray.push(criteria.seen ? 'SEEN' : 'UNSEEN');
    }
    if (criteria.flagged !== undefined) {
      searchArray.push(criteria.flagged ? 'FLAGGED' : 'UNFLAGGED');
    }
    if (criteria.answered !== undefined) {
      searchArray.push(criteria.answered ? 'ANSWERED' : 'UNANSWERED');
    }
    if (criteria.draft !== undefined) {
      searchArray.push(criteria.draft ? 'DRAFT' : 'UNDRAFT');
    }

    return searchArray.length > 0 ? searchArray : ['ALL'];
  }

  // Get connection state (useful for debugging)
  getConnectionState(accountId: string): ConnectionState {
    return this.connectionMetadata.get(accountId)?.state || ConnectionState.DISCONNECTED;
  }

  // ==================== Level 3: Circuit Breaker Pattern ====================

  private getCircuitBreakerConfig(config?: CircuitBreakerConfig): Required<CircuitBreakerConfig> {
    return {
      failureThreshold: config?.failureThreshold || 5,
      successThreshold: config?.successThreshold || 2,
      timeout: config?.timeout || 60000,
      monitoringWindow: config?.monitoringWindow || 120000
    };
  }

  private checkCircuitBreaker(accountId: string): boolean {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.circuitBreaker) return true;

    const circuit = metadata.circuitBreaker;
    const now = new Date();

    // If circuit is OPEN, check if timeout has passed
    if (circuit.state === CircuitState.OPEN) {
      if (circuit.nextAttemptTime && now >= circuit.nextAttemptTime) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.successes = 0;
        console.error(`[IMAP] Circuit breaker for ${accountId} entering HALF_OPEN state`);
        return true;
      }
      console.error(`[IMAP] Circuit breaker OPEN for ${accountId}, rejecting operation`);
      return false;
    }

    return true;
  }

  private recordCircuitSuccess(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.circuitBreaker) return;

    const account = this.accountStore.get(accountId);
    const config = this.getCircuitBreakerConfig(account?.circuitBreaker);
    const circuit = metadata.circuitBreaker;

    circuit.successes++;
    circuit.failures = 0;

    if (circuit.state === CircuitState.HALF_OPEN && circuit.successes >= config.successThreshold) {
      circuit.state = CircuitState.CLOSED;
      circuit.failureTimestamps = [];
      console.error(`[IMAP] Circuit breaker for ${accountId} closed after ${circuit.successes} successes`);
    }
  }

  private recordCircuitFailure(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.circuitBreaker) return;

    const account = this.accountStore.get(accountId);
    const config = this.getCircuitBreakerConfig(account?.circuitBreaker);
    const circuit = metadata.circuitBreaker;
    const now = new Date();

    circuit.failures++;
    circuit.successes = 0;
    circuit.lastFailureTime = now;
    circuit.failureTimestamps.push(now);

    // Remove old timestamps outside monitoring window
    const windowStart = new Date(now.getTime() - config.monitoringWindow);
    circuit.failureTimestamps = circuit.failureTimestamps.filter(t => t >= windowStart);

    // Check if we should open the circuit
    if (circuit.failureTimestamps.length >= config.failureThreshold) {
      circuit.state = CircuitState.OPEN;
      circuit.nextAttemptTime = new Date(now.getTime() + config.timeout);
      console.error(`[IMAP] Circuit breaker OPENED for ${accountId} after ${circuit.failureTimestamps.length} failures`);
    }
  }

  // ==================== Level 3: Operation Queue ====================

  private getQueueConfig(config?: OperationQueueConfig): Required<OperationQueueConfig> {
    return {
      maxSize: config?.maxSize || 1000,
      maxRetries: config?.maxRetries || 3,
      processingInterval: config?.processingInterval || 5000,
      enablePriority: config?.enablePriority !== false
    };
  }

  private queueOperation(accountId: string, operation: string, args: any[], priority = 0): string {
    const account = this.accountStore.get(accountId);
    const config = this.getQueueConfig(account?.operationQueue);

    if (this.operationQueue.length >= config.maxSize) {
      throw new Error(`Operation queue full (max: ${config.maxSize})`);
    }

    const queuedOp: QueuedOperation = {
      id: `${accountId}-${operation}-${Date.now()}-${Math.random()}`,
      accountId,
      operation,
      args,
      timestamp: new Date(),
      retries: 0,
      priority
    };

    this.operationQueue.push(queuedOp);

    // Sort by priority if enabled
    if (config.enablePriority) {
      this.operationQueue.sort((a, b) => b.priority - a.priority);
    }

    // Start queue processor if not already running
    this.startQueueProcessor();

    console.error(`[IMAP] Queued operation ${operation} for ${accountId} (queue size: ${this.operationQueue.length})`);
    return queuedOp.id;
  }

  private startQueueProcessor(): void {
    if (this.queueProcessorInterval) return;

    this.queueProcessorInterval = setInterval(async () => {
      await this.processQueue();
    }, 5000); // Process every 5 seconds
  }

  private stopQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = undefined;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.operationQueue.length === 0) {
      this.stopQueueProcessor();
      return;
    }

    const operation = this.operationQueue.shift();
    if (!operation) return;

    const account = this.accountStore.get(operation.accountId);
    if (!account) {
      console.error(`[IMAP] Account ${operation.accountId} not found for queued operation`);
      return;
    }

    const config = this.getQueueConfig(account.operationQueue);
    const metadata = this.connectionMetadata.get(operation.accountId);

    // Only process if connection is available
    if (metadata?.state !== ConnectionState.CONNECTED) {
      if (operation.retries < config.maxRetries) {
        operation.retries++;
        this.operationQueue.push(operation); // Re-queue
        console.error(`[IMAP] Re-queuing operation ${operation.operation} for ${operation.accountId} (retry ${operation.retries}/${config.maxRetries})`);
      } else {
        console.error(`[IMAP] Discarding operation ${operation.operation} for ${operation.accountId} after ${operation.retries} retries`);
      }
      return;
    }

    console.error(`[IMAP] Processing queued operation ${operation.operation} for ${operation.accountId}`);
    // Note: Actual operation execution would happen here based on operation type
    // For now, this is a framework for queuing - specific operations would need handlers
  }

  // ==================== Level 3: Metrics and Monitoring ====================

  private recordOperationMetrics(operationName: string, latency: number, success: boolean, accountId: string): void {
    // Update per-operation metrics
    let opMetrics = this.operationMetrics.get(operationName);
    if (!opMetrics) {
      opMetrics = {
        operationName,
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        averageLatency: 0,
        minLatency: Infinity,
        maxLatency: 0
      };
      this.operationMetrics.set(operationName, opMetrics);
    }

    opMetrics.count++;
    opMetrics.totalLatency += latency;
    opMetrics.averageLatency = opMetrics.totalLatency / opMetrics.count;
    opMetrics.minLatency = Math.min(opMetrics.minLatency, latency);
    opMetrics.maxLatency = Math.max(opMetrics.maxLatency, latency);
    opMetrics.lastExecuted = new Date();

    if (success) {
      opMetrics.successCount++;
    } else {
      opMetrics.failureCount++;
    }

    // Update connection metrics
    const metadata = this.connectionMetadata.get(accountId);
    if (metadata?.metrics) {
      const metrics = metadata.metrics;
      metrics.totalOperations++;
      metrics.lastOperationTime = new Date();

      if (success) {
        metrics.successfulOperations++;
      } else {
        metrics.failedOperations++;
      }

      // Update average latency
      const totalLatency = (metrics.averageLatency * (metrics.totalOperations - 1)) + latency;
      metrics.averageLatency = totalLatency / metrics.totalOperations;

      // Calculate uptime percentage
      const totalOps = metrics.totalOperations;
      if (totalOps > 0) {
        metrics.uptimePercentage = (metrics.successfulOperations / totalOps) * 100;
      }
    }
  }

  getMetrics(accountId: string): ConnectionMetrics | undefined {
    return this.connectionMetadata.get(accountId)?.metrics;
  }

  getOperationMetrics(operationName?: string): OperationMetrics[] {
    if (operationName) {
      const metrics = this.operationMetrics.get(operationName);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.operationMetrics.values());
  }

  resetMetrics(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (metadata?.metrics) {
      metadata.metrics = {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        averageLatency: 0,
        uptimePercentage: 100,
        connectionUptime: 0,
        totalDowntime: 0,
        lastMetricsReset: new Date()
      };
    }
  }

  // ==================== Level 3: Graceful Degradation ====================

  private getDegradationConfig(config?: DegradationConfig): Required<DegradationConfig> {
    return {
      enableReadOnlyMode: config?.enableReadOnlyMode !== false,
      enableCaching: config?.enableCaching !== false,
      cacheTimeout: config?.cacheTimeout || 300000, // 5 minutes
      fallbackToLastKnown: config?.fallbackToLastKnown !== false,
      maxDegradationTime: config?.maxDegradationTime || 3600000 // 1 hour
    };
  }

  private async getCachedData<T>(accountId: string, cacheKey: string): Promise<T | null> {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.cacheData) return null;

    const account = this.accountStore.get(accountId);
    const config = this.getDegradationConfig(account?.degradation);

    if (!config.enableCaching) return null;

    const cached = metadata.cacheData.get(cacheKey);
    if (!cached) return null;

    const now = new Date();
    const age = now.getTime() - cached.timestamp.getTime();

    if (age > config.cacheTimeout) {
      metadata.cacheData.delete(cacheKey);
      return null;
    }

    console.error(`[IMAP] Returning cached data for ${cacheKey} (age: ${Math.round(age / 1000)}s)`);
    return cached.data as T;
  }

  private setCachedData(accountId: string, cacheKey: string, data: any): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata?.cacheData) return;

    const account = this.accountStore.get(accountId);
    const config = this.getDegradationConfig(account?.degradation);

    if (!config.enableCaching) return;

    metadata.cacheData.set(cacheKey, {
      data,
      timestamp: new Date()
    });
  }

  private checkDegradationMode(accountId: string): boolean {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata) return false;

    const account = this.accountStore.get(accountId);
    const config = this.getDegradationConfig(account?.degradation);

    // Check if we've been in degraded mode too long
    if (metadata.degradationStartTime) {
      const now = new Date();
      const degradationTime = now.getTime() - metadata.degradationStartTime.getTime();

      if (degradationTime > config.maxDegradationTime) {
        console.error(`[IMAP] Max degradation time exceeded for ${accountId}, forcing full reconnection`);
        metadata.degradationStartTime = undefined;
        return false;
      }
    }

    return true;
  }

  private enterDegradationMode(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata) return;

    if (!metadata.degradationStartTime) {
      metadata.degradationStartTime = new Date();
      console.error(`[IMAP] Entering degradation mode for ${accountId}`);
    }
  }

  private exitDegradationMode(accountId: string): void {
    const metadata = this.connectionMetadata.get(accountId);
    if (!metadata) return;

    if (metadata.degradationStartTime) {
      const duration = new Date().getTime() - metadata.degradationStartTime.getTime();
      console.error(`[IMAP] Exiting degradation mode for ${accountId} after ${Math.round(duration / 1000)}s`);
      metadata.degradationStartTime = undefined;
    }
  }
}

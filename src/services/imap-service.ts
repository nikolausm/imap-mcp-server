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
  BulkOperationResult
} from '../types/index.js';

export class ImapService {
  private connectionPool: ConnectionPool = {};
  private activeConnections: Map<string, Imap> = new Map();
  private connectionMetadata: Map<string, ConnectionMetadata> = new Map();
  private accountStore: Map<string, ImapAccount> = new Map();

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

  // Level 2: Retry wrapper for operations
  private async withRetry<T>(
    accountId: string,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const account = this.accountStore.get(accountId);
    const retryConfig = this.getRetryConfig(account?.retry);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        console.error(`[IMAP] ${operationName} failed (attempt ${attempt + 1}/${retryConfig.maxAttempts + 1}):`, error);

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
        reconnectAttempts: 0
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
    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        connection.addFlags(uid, '\\Seen', (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }, `markAsRead(uid:${uid})`);
  }

  async markAsUnread(accountId: string, folderName: string, uid: number): Promise<void> {
    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        connection.delFlags(uid, '\\Seen', (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }, `markAsUnread(uid:${uid})`);
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
    return this.withRetry(accountId, async () => {
      await this.selectFolder(accountId, folderName);
      const connection = this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        connection.addFlags(uid, '\\Deleted', (err: Error) => {
          if (err) {
            reject(err);
            return;
          }
          connection.expunge((err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    }, `deleteEmail(uid:${uid})`);
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
}

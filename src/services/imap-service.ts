import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, Folder, SearchCriteria, ConnectionPool, KeepAliveConfig } from '../types/index.js';
import { promisify } from 'util';

export class ImapService {
  private connectionPool: ConnectionPool = {};
  private activeConnections: Map<string, Imap> = new Map();

  async connect(account: ImapAccount): Promise<void> {
    if (this.activeConnections.has(account.id)) {
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
    this.setupConnectionMonitoring(imap, account.id);

    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        this.activeConnections.set(account.id, imap);
        console.log(`[IMAP] Connection established for account ${account.id}`);
        resolve();
      });

      imap.once('error', (err: Error) => {
        console.error(`[IMAP] Connection error for account ${account.id}:`, err.message);
        reject(err);
      });

      imap.connect();
    });
  }

  private buildKeepAliveConfig(keepalive?: boolean | KeepAliveConfig): boolean | KeepAliveConfig {
    // If keepalive is explicitly false, return false
    if (keepalive === false) {
      return false;
    }

    // If keepalive is a config object, merge with defaults
    if (typeof keepalive === 'object') {
      return {
        interval: keepalive.interval || 10000,        // 10 seconds
        idleInterval: keepalive.idleInterval || 1740000, // 29 minutes
        forceNoop: keepalive.forceNoop !== false,     // true by default
      };
    }

    // Default keepalive configuration (when true or undefined)
    return {
      interval: 10000,        // 10 seconds TCP keepalive
      idleInterval: 1740000,  // 29 minutes IMAP keepalive (per RFC 2177)
      forceNoop: true,        // Use NOOP instead of IDLE
    };
  }

  private setupConnectionMonitoring(imap: Imap, accountId: string): void {
    // Handle connection errors
    imap.on('error', (err: Error) => {
      console.error(`[IMAP] Error on connection ${accountId}:`, err.message);
      this.activeConnections.delete(accountId);
    });

    // Handle connection end
    imap.on('end', () => {
      console.log(`[IMAP] Connection ended for account ${accountId}`);
      this.activeConnections.delete(accountId);
    });

    // Handle connection close
    imap.on('close', (hadError: boolean) => {
      console.log(`[IMAP] Connection closed for account ${accountId}, hadError: ${hadError}`);
      this.activeConnections.delete(accountId);
    });
  }

  private isConnectionAlive(accountId: string): boolean {
    const connection = this.activeConnections.get(accountId);
    if (!connection) {
      return false;
    }

    // Check if connection state is valid
    const state = (connection as any).state;
    return state === 'authenticated' || state === 'connected';
  }

  private async ensureConnection(accountId: string, account?: ImapAccount): Promise<void> {
    if (!this.isConnectionAlive(accountId)) {
      if (!account) {
        throw new Error(`Connection lost for account ${accountId} and no account info provided for reconnection`);
      }
      console.log(`[IMAP] Connection not alive for ${accountId}, reconnecting...`);
      await this.connect(account);
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const connection = this.activeConnections.get(accountId);
    if (connection) {
      connection.end();
      this.activeConnections.delete(accountId);
    }
  }

  async listFolders(accountId: string): Promise<Folder[]> {
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
  }

  async selectFolder(accountId: string, folderName: string): Promise<any> {
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
  }

  async searchEmails(accountId: string, folderName: string, criteria: SearchCriteria): Promise<EmailMessage[]> {
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
  }

  async getEmailContent(accountId: string, folderName: string, uid: number): Promise<EmailContent> {
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
  }

  async markAsRead(accountId: string, folderName: string, uid: number): Promise<void> {
    await this.selectFolder(accountId, folderName);
    const connection = this.getConnection(accountId);
    
    return new Promise((resolve, reject) => {
      connection.addFlags(uid, '\\Seen', (err: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async markAsUnread(accountId: string, folderName: string, uid: number): Promise<void> {
    await this.selectFolder(accountId, folderName);
    const connection = this.getConnection(accountId);
    
    return new Promise((resolve, reject) => {
      connection.delFlags(uid, '\\Seen', (err: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async deleteEmail(accountId: string, folderName: string, uid: number): Promise<void> {
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
  }

  async bulkDeleteEmails(accountId: string, folderName: string, uids: number[], expunge: boolean = false): Promise<void> {
    if (uids.length === 0) {
      return;
    }

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
}
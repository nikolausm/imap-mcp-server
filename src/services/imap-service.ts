import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { ImapAccount, EmailMessage, EmailContent, Folder, SearchCriteria, ConnectionPool } from '../types/index.js';
import { promisify } from 'util';

export class ImapService {
  private connectionPool: ConnectionPool = {};
  private activeConnections: Map<string, Imap> = new Map();

  async connect(account: ImapAccount): Promise<void> {
    if (this.activeConnections.has(account.id)) {
      return;
    }

    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: account.host,
      port: account.port,
      tls: account.tls,
      authTimeout: account.authTimeout || 3000,
      connTimeout: account.connTimeout || 10000,
      keepalive: account.keepalive !== false,
    });

    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        this.activeConnections.set(account.id, imap);
        resolve();
      });

      imap.once('error', (err: Error) => {
        reject(err);
      });

      imap.connect();
    });
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
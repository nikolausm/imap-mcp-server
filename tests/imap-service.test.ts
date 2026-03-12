import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simpleParser } from 'mailparser';
import { ImapService } from '../src/services/imap-service.js';
import { ImapAccount } from '../src/types/index.js';

// Create a mock class for ImapFlow
class MockImapFlow {
  public connectMock = vi.fn().mockResolvedValue(undefined);
  public logoutMock = vi.fn().mockResolvedValue(undefined);
  public listMock = vi.fn().mockResolvedValue([]);
  public mailboxOpenMock = vi.fn().mockResolvedValue({});
  public getMailboxLockMock = vi.fn().mockResolvedValue({ release: vi.fn() });
  public searchMock = vi.fn().mockResolvedValue([]);
  public fetchMock = vi.fn();
  public fetchOneMock = vi.fn().mockResolvedValue(null);
  public messageFlagsAddMock = vi.fn().mockResolvedValue(undefined);
  public messageFlagsRemoveMock = vi.fn().mockResolvedValue(undefined);
  public messageDeleteMock = vi.fn().mockResolvedValue(undefined);
  public messageMoveMock = vi.fn().mockResolvedValue(undefined);
  public statusMock = vi.fn().mockResolvedValue({ messages: 10 });
  public usable = true;
  public onMock = vi.fn();

  connect() { return this.connectMock(); }
  logout() { return this.logoutMock(); }
  list() { return this.listMock(); }
  mailboxOpen(name: string) { return this.mailboxOpenMock(name); }
  getMailboxLock(name: string) { return this.getMailboxLockMock(name); }
  search(query: any, opts: any) { return this.searchMock(query, opts); }
  fetch(uids: any, query: any, options?: any) { return this.fetchMock(uids, query, options); }
  fetchOne(uid: any, opts: any, options: any) { return this.fetchOneMock(uid, opts, options); }
  messageFlagsAdd(uid: any, flags: any, opts: any) { return this.messageFlagsAddMock(uid, flags, opts); }
  messageFlagsRemove(uid: any, flags: any, opts: any) { return this.messageFlagsRemoveMock(uid, flags, opts); }
  messageDelete(uid: any, opts: any) { return this.messageDeleteMock(uid, opts); }
  messageMove(uid: any, target: any, opts: any) { return this.messageMoveMock(uid, target, opts); }
  status(name: string, opts: any) { return this.statusMock(name, opts); }
  on(event: string, handler: any) { return this.onMock(event, handler); }
}

let mockInstance: MockImapFlow;

// Mock imapflow module
vi.mock('imapflow', () => {
  return {
    ImapFlow: class {
      constructor() {
        // Copy all properties from mockInstance
        Object.assign(this, mockInstance);
        // Bind methods
        this.connect = mockInstance.connect.bind(mockInstance);
        this.logout = mockInstance.logout.bind(mockInstance);
        this.list = mockInstance.list.bind(mockInstance);
        this.mailboxOpen = mockInstance.mailboxOpen.bind(mockInstance);
        this.getMailboxLock = mockInstance.getMailboxLock.bind(mockInstance);
        this.search = mockInstance.search.bind(mockInstance);
        this.fetch = mockInstance.fetch.bind(mockInstance);
        this.fetchOne = mockInstance.fetchOne.bind(mockInstance);
        this.messageFlagsAdd = mockInstance.messageFlagsAdd.bind(mockInstance);
        this.messageFlagsRemove = mockInstance.messageFlagsRemove.bind(mockInstance);
        this.messageDelete = mockInstance.messageDelete.bind(mockInstance);
        this.messageMove = mockInstance.messageMove.bind(mockInstance);
        this.status = mockInstance.status.bind(mockInstance);
        this.on = mockInstance.on.bind(mockInstance);
      }
    },
  };
});

// Mock mailparser
vi.mock('mailparser', () => ({
  simpleParser: vi.fn().mockResolvedValue({
    date: new Date(),
    from: { text: 'sender@test.com' },
    to: [{ text: 'recipient@test.com' }],
    subject: 'Test Subject',
    messageId: '<test@message.id>',
    text: 'Plain text content',
    html: '<p>HTML content</p>',
    attachments: [],
  }),
}));

describe('ImapService', () => {
  let imapService: ImapService;
  let mockAccount: ImapAccount;

  beforeEach(() => {
    // Create fresh mock instance before each test
    mockInstance = new MockImapFlow();

    imapService = new ImapService();
    mockAccount = {
      id: 'test-account-id',
      name: 'Test Account',
      host: 'imap.test.com',
      port: 993,
      user: 'user@test.com',
      password: 'password123',
      tls: true,
    };
  });

  describe('connect', () => {
    it('should connect to IMAP server', async () => {
      await expect(imapService.connect(mockAccount)).resolves.toBeUndefined();
      expect(mockInstance.connectMock).toHaveBeenCalled();
    });

    it('should set up event handlers', async () => {
      await imapService.connect(mockAccount);
      expect(mockInstance.onMock).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockInstance.onMock).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('disconnect', () => {
    it('should disconnect from IMAP server', async () => {
      await imapService.connect(mockAccount);
      await expect(imapService.disconnect(mockAccount.id)).resolves.toBeUndefined();
      expect(mockInstance.logoutMock).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      await expect(imapService.disconnect('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('listFolders', () => {
    it('should list folders', async () => {
      mockInstance.listMock.mockResolvedValue([
        { path: 'INBOX', delimiter: '/', flags: ['\\HasNoChildren'] },
        { path: 'Sent', delimiter: '/', flags: ['\\Sent'] },
      ]);

      await imapService.connect(mockAccount);
      const folders = await imapService.listFolders(mockAccount.id);

      expect(folders).toHaveLength(2);
      expect(folders[0].name).toBe('INBOX');
      expect(folders[1].name).toBe('Sent');
    });
  });

  describe('testConnection', () => {
    it('should test connection successfully', async () => {
      mockInstance.listMock.mockResolvedValue([
        { path: 'INBOX' },
        { path: 'Sent' },
      ]);
      mockInstance.statusMock.mockResolvedValue({ messages: 42 });

      const result = await imapService.testConnection(mockAccount);

      expect(result.success).toBe(true);
      expect(result.folders).toContain('INBOX');
      expect(result.messageCount).toBe(42);
    });

    it('should return error on connection failure', async () => {
      mockInstance.connectMock.mockRejectedValue(new Error('Connection refused'));

      const result = await imapService.testConnection(mockAccount);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('bulkDelete', () => {
    it('should move emails to Trash in chunks', async () => {
      await imapService.connect(mockAccount);

      const uids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = await imapService.bulkDelete(mockAccount.id, 'INBOX', uids, 5);

      expect(result.deleted).toBe(10);
      expect(result.failed).toBe(0);
      expect(mockInstance.messageMoveMock).toHaveBeenCalledTimes(2); // 2 chunks of 5
      expect(mockInstance.messageMoveMock).toHaveBeenCalledWith('1,2,3,4,5', 'Trash', { uid: true });
    });

    it('should permanently delete when already in Trash', async () => {
      await imapService.connect(mockAccount);

      const uids = [1, 2, 3];
      const result = await imapService.bulkDelete(mockAccount.id, 'Trash', uids, 5);

      expect(result.deleted).toBe(3);
      expect(mockInstance.messageDeleteMock).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during bulk delete', async () => {
      mockInstance.messageMoveMock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Move failed'));

      await imapService.connect(mockAccount);

      const uids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = await imapService.bulkDelete(mockAccount.id, 'INBOX', uids, 5);

      expect(result.deleted).toBe(5);
      expect(result.failed).toBe(5);
      expect(result.errors.length).toBe(1);
    });

    it('should call progress callback', async () => {
      await imapService.connect(mockAccount);

      const progressFn = vi.fn();
      const uids = [1, 2, 3, 4, 5, 6];
      await imapService.bulkDelete(mockAccount.id, 'INBOX', uids, 3, progressFn);

      expect(progressFn).toHaveBeenCalledTimes(2);
      expect(progressFn).toHaveBeenCalledWith(3, 6);
      expect(progressFn).toHaveBeenCalledWith(6, 6);
    });
  });

  describe('search criteria building', () => {
    it('should search with from criteria', async () => {
      mockInstance.fetchMock.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true }),
        }),
      });

      await imapService.connect(mockAccount);
      await imapService.searchEmails(mockAccount.id, 'INBOX', { from: 'test@example.com' });

      expect(mockInstance.searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'test@example.com' }),
        expect.any(Object)
      );
    });

    it('should search all when no criteria', async () => {
      mockInstance.fetchMock.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true }),
        }),
      });

      await imapService.connect(mockAccount);
      await imapService.searchEmails(mockAccount.id, 'INBOX', {});

      expect(mockInstance.searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ all: true }),
        expect.any(Object)
      );
    });

    it('should fetch search results using UIDs', async () => {
      mockInstance.searchMock.mockResolvedValue([101, 105]);
      mockInstance.fetchMock.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true }),
        }),
      });

      await imapService.connect(mockAccount);
      await imapService.searchEmails(mockAccount.id, 'INBOX', {});

      expect(mockInstance.fetchMock).toHaveBeenCalledWith(
        [101, 105],
        expect.objectContaining({ uid: true, envelope: true, flags: true, internalDate: true }),
        { uid: true }
      );
    });
  });

  describe('getLatestEmails', () => {
    it('should fetch only the latest UIDs and sort by date', async () => {
      const messageDates = [
        new Date('2025-01-08T10:00:00Z'),
        new Date('2025-01-09T09:00:00Z'),
      ];

      mockInstance.searchMock.mockResolvedValue([1, 2, 3, 4]);
      mockInstance.fetchMock.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let index = 0;
          return {
            next: () => {
              if (index >= messageDates.length) {
                return Promise.resolve({ done: true });
              }
              const msg = {
                uid: index === 0 ? 3 : 4,
                internalDate: messageDates[index],
                envelope: {
                  date: messageDates[index],
                  from: [{ name: 'Tester', address: 'tester@example.com' }],
                  to: [{ name: 'Recipient', address: 'recipient@example.com' }],
                  subject: `Test ${index}`,
                  messageId: `<test-${index}@example.com>`,
                },
                flags: new Set<string>(),
              };
              index += 1;
              return Promise.resolve({ value: msg, done: false });
            },
          };
        },
      });

      await imapService.connect(mockAccount);
      const result = await imapService.getLatestEmails(mockAccount.id, 'INBOX', 2);

      expect(mockInstance.fetchMock).toHaveBeenCalledWith(
        [3, 4],
        expect.objectContaining({ uid: true, envelope: true, flags: true, internalDate: true }),
        { uid: true }
      );
      expect(result).toHaveLength(2);
      expect(result[0].uid).toBe(4);
      expect(result[1].uid).toBe(3);
    });
  });

  describe('error handling', () => {
    it('should throw error when no connection exists', async () => {
      await expect(
        imapService.listFolders('non-existent-account')
      ).rejects.toThrow('No connection configured for account non-existent-account');
    });
  });

  describe('markAsRead', () => {
    it('should add Seen flag', async () => {
      await imapService.connect(mockAccount);
      await imapService.markAsRead(mockAccount.id, 'INBOX', 123);

      expect(mockInstance.messageFlagsAddMock).toHaveBeenCalledWith(
        123,
        ['\\Seen'],
        { uid: true }
      );
    });
  });

  describe('markAsUnread', () => {
    it('should remove Seen flag', async () => {
      await imapService.connect(mockAccount);
      await imapService.markAsUnread(mockAccount.id, 'INBOX', 123);

      expect(mockInstance.messageFlagsRemoveMock).toHaveBeenCalledWith(
        123,
        ['\\Seen'],
        { uid: true }
      );
    });
  });

  describe('deleteEmail', () => {
    it('should move email to Trash when not in Trash', async () => {
      await imapService.connect(mockAccount);
      await imapService.deleteEmail(mockAccount.id, 'INBOX', 123);

      expect(mockInstance.messageMoveMock).toHaveBeenCalledWith(
        123,
        'Trash',
        { uid: true }
      );
    });

    it('should permanently delete when already in Trash', async () => {
      await imapService.connect(mockAccount);
      await imapService.deleteEmail(mockAccount.id, 'Trash', 123);

      expect(mockInstance.messageDeleteMock).toHaveBeenCalledWith(
        123,
        { uid: true }
      );
    });
  });

  describe('moveEmail', () => {
    it('should move email to target folder', async () => {
      await imapService.connect(mockAccount);
      await imapService.moveEmail(mockAccount.id, 'INBOX', 123, 'Archive');

      expect(mockInstance.messageMoveMock).toHaveBeenCalledWith(
        123,
        'Archive',
        { uid: true }
      );
    });
  });

  describe('getAttachmentContent', () => {
    const mockedSimpleParser = vi.mocked(simpleParser);

    beforeEach(() => {
      // Reset simpleParser to default mock for non-attachment tests
      mockedSimpleParser.mockResolvedValue({
        date: new Date(),
        from: { text: 'sender@test.com' },
        to: [{ text: 'recipient@test.com' }],
        subject: 'Test Subject',
        messageId: '<test@message.id>',
        text: 'Plain text content',
        html: '<p>HTML content</p>',
        attachments: [],
      } as any);
    });

    it('should download attachment by filename', async () => {
      const attachmentBuffer = Buffer.from('file content here');

      mockInstance.fetchOneMock.mockResolvedValue({
        source: Buffer.from('fake raw email source'),
      });

      mockedSimpleParser.mockResolvedValue({
        attachments: [
          {
            filename: 'report.pdf',
            content: attachmentBuffer,
            contentType: 'application/pdf',
            contentId: undefined,
          },
        ],
      } as any);

      await imapService.connect(mockAccount);
      const result = await imapService.getAttachmentContent(
        mockAccount.id,
        'INBOX',
        42,
        'report.pdf'
      );

      expect(result.content).toBe(attachmentBuffer);
      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toBe('report.pdf');
      expect(mockInstance.fetchOneMock).toHaveBeenCalledWith(42, { source: true }, { uid: true });
    });

    it('should download attachment by contentId', async () => {
      const attachmentBuffer = Buffer.from('inline image data');

      mockInstance.fetchOneMock.mockResolvedValue({
        source: Buffer.from('fake raw email source'),
      });

      mockedSimpleParser.mockResolvedValue({
        attachments: [
          {
            filename: 'image.png',
            content: attachmentBuffer,
            contentType: 'image/png',
            contentId: 'cid-12345',
          },
        ],
      } as any);

      await imapService.connect(mockAccount);
      const result = await imapService.getAttachmentContent(
        mockAccount.id,
        'INBOX',
        99,
        'cid-12345'
      );

      expect(result.content).toBe(attachmentBuffer);
      expect(result.contentType).toBe('image/png');
      expect(result.filename).toBe('image.png');
    });

    it('should throw error when email not found', async () => {
      mockInstance.fetchOneMock.mockResolvedValue(null);

      await imapService.connect(mockAccount);

      await expect(
        imapService.getAttachmentContent(mockAccount.id, 'INBOX', 999, 'file.txt')
      ).rejects.toThrow('Email with UID 999 not found');
    });

    it('should throw error when source is empty', async () => {
      mockInstance.fetchOneMock.mockResolvedValue({ source: null });

      await imapService.connect(mockAccount);

      await expect(
        imapService.getAttachmentContent(mockAccount.id, 'INBOX', 888, 'file.txt')
      ).rejects.toThrow('Email with UID 888 not found');
    });

    it('should throw error when attachment not found in email', async () => {
      mockInstance.fetchOneMock.mockResolvedValue({
        source: Buffer.from('fake raw email source'),
      });

      mockedSimpleParser.mockResolvedValue({
        attachments: [
          {
            filename: 'other-file.doc',
            content: Buffer.from('other content'),
            contentType: 'application/msword',
            contentId: undefined,
          },
        ],
      } as any);

      await imapService.connect(mockAccount);

      await expect(
        imapService.getAttachmentContent(mockAccount.id, 'INBOX', 42, 'missing-file.pdf')
      ).rejects.toThrow('Attachment "missing-file.pdf" not found in email UID 42');
    });
  });
});

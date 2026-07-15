import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

// #106 regression suite: covers includeBody + bodyFormat + bodyMaxLength on
// imap_search_emails / imap_get_latest_emails / imap_find_thread_messages,
// and batch UID support on imap_mark_as_read / imap_mark_as_unread /
// imap_move_email. All paths are backwards-compatible — these tests exercise
// both the legacy single-uid/no-body calls and the new batch/includeBody ones.

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    toolHandlers[name] = handler;
  }),
};

const toolHandlers: Record<string, Function> = {};

const mockImapService = {
  listFolders: vi.fn(),
  searchEmails: vi.fn(),
  getLatestEmails: vi.fn(),
  findThreadMessages: vi.fn(),
  moveEmail: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
};

const mockAccountManager = {
  resolveAccountId: (id: string) => id ?? 'acc1',
};

const msg = (uid: number, date: string, subject = 's', from = 'a@b.com') => ({
  uid,
  date: new Date(date),
  from,
  subject,
  to: [],
  messageId: `<${uid}@example.com>`,
  flags: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(toolHandlers)) delete toolHandlers[k];
  emailTools(mockServer as any, mockImapService as any, mockAccountManager as any, {} as any);
});

describe('imap_search_emails — includeBody', () => {
  it('defaults to lightweight headers when includeBody is not set (backwards compat)', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      msg(1, '2026-01-01'),
      msg(2, '2026-02-01'),
    ]);

    const result = await toolHandlers.imap_search_emails({ accountId: 'acc1', folder: 'INBOX', limit: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toHaveLength(2);
    for (const m of parsed.messages) {
      expect(m).not.toHaveProperty('textContent');
      expect(m).not.toHaveProperty('markdownContent');
      expect(m).not.toHaveProperty('htmlContent');
    }
    // searchOptions is passed with defaults so the service sees stable values.
    expect(mockImapService.searchEmails).toHaveBeenCalledWith(
      'acc1',
      'INBOX',
      expect.anything(),
      expect.objectContaining({ includeBody: false, bodyFormat: 'markdown', bodyMaxLength: 10000 }),
    );
  });

  it('passes includeBody=true through to the service', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([msg(1, '2026-01-01')]);

    await toolHandlers.imap_search_emails({
      accountId: 'acc1',
      folder: 'INBOX',
      limit: 5,
      includeBody: true,
      bodyFormat: 'text',
      bodyMaxLength: 500,
    });

    expect(mockImapService.searchEmails).toHaveBeenCalledWith(
      'acc1',
      'INBOX',
      expect.anything(),
      expect.objectContaining({ includeBody: true, bodyFormat: 'text', bodyMaxLength: 500 }),
    );
  });

  it('does not pass includeBody through to the cross-folder search (documented limitation)', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([
      { name: 'INBOX', delimiter: '/', attributes: [] },
    ]);
    mockImapService.searchEmails.mockResolvedValueOnce([msg(1, '2026-01-01')]);

    await toolHandlers.imap_search_emails({
      accountId: 'acc1',
      searchAllFolders: true,
      limit: 10,
      includeBody: true,
    });

    // The cross-folder path must not pass searchOptions so it stays lightweight
    // and does not multiply source-byte fetches across folders. When searchOptions
    // is undefined, the mock receives a 3-arg call (JS drops trailing undefineds).
    const calls = mockImapService.searchEmails.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe('acc1');
    expect(lastCall[1]).toBe('INBOX');
    // lastCall[2] is the criteria object — third arg present.
    expect(lastCall[2]).toBeDefined();
    // searchOptions is either omitted or undefined — never populated with body fields.
    expect(lastCall[3]).toBeUndefined();
  });
});

describe('imap_get_latest_emails — includeBody', () => {
  it('defaults to lightweight headers when includeBody is not set (backwards compat)', async () => {
    mockImapService.getLatestEmails.mockResolvedValueOnce([msg(1, '2026-01-01')]);

    const result = await toolHandlers.imap_get_latest_emails({ accountId: 'acc1', folder: 'INBOX', count: 5 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).not.toHaveProperty('markdownContent');
    expect(mockImapService.getLatestEmails).toHaveBeenCalledWith(
      'acc1',
      'INBOX',
      5,
      expect.objectContaining({ includeBody: false, bodyFormat: 'markdown', bodyMaxLength: 10000 }),
    );
  });

  it('forwards includeBody/bodyFormat/bodyMaxLength to the service', async () => {
    mockImapService.getLatestEmails.mockResolvedValueOnce([msg(1, '2026-01-01')]);

    await toolHandlers.imap_get_latest_emails({
      accountId: 'acc1',
      folder: 'INBOX',
      count: 5,
      includeBody: true,
      bodyFormat: 'html',
      bodyMaxLength: 2000,
    });

    expect(mockImapService.getLatestEmails).toHaveBeenCalledWith(
      'acc1',
      'INBOX',
      5,
      expect.objectContaining({ includeBody: true, bodyFormat: 'html', bodyMaxLength: 2000 }),
    );
  });
});

describe('imap_find_thread_messages — includeBody', () => {
  it('returns uids only when includeBody is omitted (backwards compat)', async () => {
    mockImapService.findThreadMessages.mockResolvedValueOnce({
      messageIds: ['<1@a>', '<2@a>'],
      uids: [10, 11],
    });

    const result = await toolHandlers.imap_find_thread_messages({
      accountId: 'acc1',
      sourceFolder: 'Review',
      searchFolder: 'INBOX',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.uids).toEqual([10, 11]);
    expect(parsed.messages).toBeUndefined();
    expect(mockImapService.findThreadMessages).toHaveBeenCalledWith(
      'acc1',
      'Review',
      'INBOX',
      expect.objectContaining({ includeBody: false, bodyFormat: 'markdown', bodyMaxLength: 10000 }),
    );
  });

  it('forwards includeBody and surfaces messages array when the service returns it', async () => {
    mockImapService.findThreadMessages.mockResolvedValueOnce({
      messageIds: ['<1@a>'],
      uids: [42],
      messages: [
        {
          uid: 42,
          date: new Date('2026-01-01'),
          from: 'a@b.com',
          to: [],
          subject: 'reply',
          messageId: '<42@example.com>',
          flags: [],
          markdownContent: '# reply\n\nhi',
          bodyFormat: 'markdown',
        },
      ],
    });

    const result = await toolHandlers.imap_find_thread_messages({
      accountId: 'acc1',
      sourceFolder: 'Review',
      searchFolder: 'INBOX',
      includeBody: true,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].uid).toBe(42);
    expect(parsed.messages[0].markdownContent).toBe('# reply\n\nhi');
  });
});

describe('imap_mark_as_read / imap_mark_as_unread — batch UID', () => {
  it('single uid keeps the legacy response shape (backwards compat)', async () => {
    mockImapService.markAsRead.mockResolvedValueOnce({ success: true, marked: [7], failed: [] });

    const result = await toolHandlers.imap_mark_as_read({ accountId: 'acc1', folder: 'INBOX', uid: 7 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('Email 7 marked as read');
    expect(parsed.batch).toBeUndefined();
    expect(mockImapService.markAsRead).toHaveBeenCalledWith('acc1', 'INBOX', 7);
  });

  it('array of 5 uids is passed through and reports per-uid counts', async () => {
    mockImapService.markAsRead.mockResolvedValueOnce({
      success: true,
      marked: [1, 2, 3, 4, 5],
      failed: [],
    });

    const result = await toolHandlers.imap_mark_as_read({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: [1, 2, 3, 4, 5],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.batch).toBe(true);
    expect(parsed.marked).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.failed).toEqual([]);
    expect(mockImapService.markAsRead).toHaveBeenCalledWith('acc1', 'INBOX', [1, 2, 3, 4, 5]);
  });

  it('batch failure surfaces per-uid errors and flips success to false', async () => {
    mockImapService.markAsRead.mockResolvedValueOnce({
      success: false,
      marked: [1, 2],
      failed: [3],
      errors: ['UID 3: not found'],
    });

    const result = await toolHandlers.imap_mark_as_read({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: [1, 2, 3],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.marked).toEqual([1, 2]);
    expect(parsed.failed).toEqual([3]);
    expect(parsed.errors).toEqual(['UID 3: not found']);
  });

  it('imap_mark_as_unread handles the same batch shape', async () => {
    mockImapService.markAsUnread.mockResolvedValueOnce({
      success: true,
      marked: [10, 11],
      failed: [],
    });

    const result = await toolHandlers.imap_mark_as_unread({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: [10, 11],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.batch).toBe(true);
    expect(parsed.marked).toEqual([10, 11]);
  });
});

describe('imap_move_email — batch UID', () => {
  it('single uid keeps the legacy response shape (backwards compat)', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Archive',
      destinationCreated: undefined,
      uidMap: new Map([[7, 100]]),
    });

    const result = await toolHandlers.imap_move_email({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 7,
      targetFolder: 'Archive',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('Email 7 moved from INBOX to Archive');
    expect(parsed.destination).toBe('Archive');
    expect(parsed.uidMap).toEqual({ '7': 100 });
    expect(parsed.batch).toBeUndefined();
    expect(mockImapService.moveEmail).toHaveBeenCalledWith(
      'acc1',
      'INBOX',
      7,
      'Archive',
      expect.objectContaining({}),
    );
  });

  it('array of 3 uids: all moved, per-uid results aggregated', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Archive',
      results: [
        { uid: 1, destination: 'Archive', uidMap: { 1: 100 } },
        { uid: 2, destination: 'Archive', uidMap: { 2: 101 } },
        { uid: 3, destination: 'Archive', uidMap: { 3: 102 } },
      ],
    });

    const result = await toolHandlers.imap_move_email({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: [1, 2, 3],
      targetFolder: 'Archive',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.batch).toBe(true);
    expect(parsed.movedCount).toBe(3);
    expect(parsed.failedCount).toBe(0);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.errors).toBeUndefined();
  });

  it('batch with partial failure: success=false, per-uid errors surfaced', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Archive',
      results: [
        { uid: 1, destination: 'Archive', uidMap: { 1: 100 } },
        { uid: 2, destination: 'Archive', uidMap: undefined, error: 'permission denied' },
        { uid: 3, destination: 'Archive', uidMap: { 3: 102 } },
      ],
    });

    const result = await toolHandlers.imap_move_email({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: [1, 2, 3],
      targetFolder: 'Archive',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.movedCount).toBe(2);
    expect(parsed.failedCount).toBe(1);
    expect(parsed.errors).toEqual([{ uid: 2, error: 'permission denied' }]);
  });
});
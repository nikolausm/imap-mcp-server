import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

let searchHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_search_emails') {
      searchHandler = handler;
    }
  }),
};

const mockImapService = {
  listFolders: vi.fn(),
  searchEmails: vi.fn(),
};

const mockAccountManager = {
  resolveAccountId: (id: string) => id ?? 'acc1',
};

const folder = (name: string, specialUse?: string) => ({
  name,
  delimiter: '/',
  attributes: [] as string[],
  specialUse,
});

const msg = (uid: number, date: string, subject = 's') => ({
  uid,
  date: new Date(date),
  from: 'a@b.com',
  subject,
  to: [],
});

describe('imap_search_emails — searchAllFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(mockServer as any, mockImapService as any, mockAccountManager as any, {} as any);
  });

  it('registers the handler', () => {
    expect(searchHandler).toBeDefined();
  });

  it('searches every selectable folder, skips noisy ones, annotates folder, sorts newest-first', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([
      folder('INBOX'),
      folder('Archive'),
      folder('Trash', '\\Trash'),
      folder('Spam', '\\Junk'),
    ]);
    mockImapService.searchEmails.mockImplementation(async (_acc: string, name: string) => {
      if (name === 'INBOX') return [msg(1, '2026-01-01', 'old')];
      if (name === 'Archive') return [msg(2, '2026-03-01', 'new')];
      return [];
    });

    const result = await searchHandler({ accountId: 'acc1', searchAllFolders: true, limit: 50 });
    const parsed = JSON.parse(result.content[0].text);

    // Trash/Spam never searched
    expect(parsed.foldersSearched).toEqual(['INBOX', 'Archive']);
    expect(mockImapService.searchEmails).not.toHaveBeenCalledWith('acc1', 'Trash', expect.anything());
    expect(mockImapService.searchEmails).not.toHaveBeenCalledWith('acc1', 'Spam', expect.anything());
    // Newest first, with folder annotation
    expect(parsed.messages.map((m: any) => m.uid)).toEqual([2, 1]);
    expect(parsed.messages[0].folder).toBe('Archive');
    expect(parsed.totalFound).toBe(2);
    expect(parsed.foldersErrored).toBeUndefined();
  });

  it('surfaces folders that fail to open in foldersErrored instead of swallowing them', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([folder('INBOX'), folder('Broken')]);
    mockImapService.searchEmails.mockImplementation(async (_acc: string, name: string) => {
      if (name === 'Broken') throw new Error('Command failed');
      return [msg(1, '2026-01-01')];
    });

    const result = await searchHandler({ accountId: 'acc1', searchAllFolders: true, limit: 50 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.foldersSearched).toEqual(['INBOX']);
    expect(parsed.foldersErrored).toEqual([{ folder: 'Broken', error: 'Command failed' }]);
    expect(parsed.messages.map((m: any) => m.uid)).toEqual([1]);
  });

  it('respects limit across folders after sorting', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([folder('INBOX'), folder('Archive')]);
    mockImapService.searchEmails.mockImplementation(async (_acc: string, name: string) => {
      if (name === 'INBOX') return [msg(1, '2026-01-01'), msg(2, '2026-02-01')];
      return [msg(3, '2026-05-01'), msg(4, '2026-04-01')];
    });

    const result = await searchHandler({ accountId: 'acc1', searchAllFolders: true, limit: 2 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.totalFound).toBe(4);
    expect(parsed.returned).toBe(2);
    expect(parsed.messages.map((m: any) => m.uid)).toEqual([3, 4]); // newest two
  });

  it('opts Trash back in with includeTrash', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([folder('INBOX'), folder('Trash', '\\Trash')]);
    mockImapService.searchEmails.mockResolvedValue([]);

    await searchHandler({ accountId: 'acc1', searchAllFolders: true, includeTrash: true, limit: 50 });

    expect(mockImapService.searchEmails).toHaveBeenCalledWith('acc1', 'Trash', expect.anything());
  });

  it('default (single-folder) path is unchanged and never lists folders', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([msg(7, '2026-01-01')]);

    const result = await searchHandler({ accountId: 'acc1', folder: 'INBOX', limit: 50 });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockImapService.listFolders).not.toHaveBeenCalled();
    // #106: searchOptions is now passed as a 4th argument with includeBody/bodyFormat/bodyMaxLength defaults.
    expect(mockImapService.searchEmails).toHaveBeenCalledWith('acc1', 'INBOX', expect.anything(), expect.objectContaining({ includeBody: false, bodyFormat: 'markdown', bodyMaxLength: 10000 }));
    expect(parsed.messages.map((m: any) => m.uid)).toEqual([7]);
    expect(parsed.foldersSearched).toBeUndefined();
  });

  // Regression for #107: single-folder search returned oldest matches when
  // IMAP UID SEARCH sorted ascending and the tool naively sliced [0..limit).
  it('single-folder search returns the newest matches when limit cuts the result (#107)', async () => {
    // Service returns oldest-first (mirrors real IMAP behaviour).
    mockImapService.searchEmails.mockResolvedValueOnce([
      msg(101, '2024-01-01', 'oldest'),
      msg(102, '2024-06-01', 'old'),
      msg(103, '2025-01-01', 'mid'),
      msg(104, '2025-06-01', 'new'),
      msg(105, '2026-01-01', 'newest'),
    ]);

    const result = await searchHandler({ accountId: 'acc1', folder: 'INBOX', limit: 2 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.totalFound).toBe(5);
    expect(parsed.returned).toBe(2);
    expect(parsed.messages.map((m: any) => m.uid)).toEqual([105, 104]); // newest two
  });

  it('single-folder search stays sorted when limit exceeds result count (#107)', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      msg(1, '2024-01-01'),
      msg(2, '2025-01-01'),
      msg(3, '2026-01-01'),
    ]);

    const result = await searchHandler({ accountId: 'acc1', folder: 'INBOX', limit: 50 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages.map((m: any) => m.uid)).toEqual([3, 2, 1]); // newest first
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { folderTools } from '../src/tools/folder-tools.js';

let folderStatusHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_folder_status') {
      folderStatusHandler = handler;
    }
  }),
};

const mockImapService = {
  selectFolder: vi.fn(),
  getFolderStatus: vi.fn(),
};

// What imapflow's mailboxOpen() actually resolves to (MailboxObject): flag
// *Sets*, camelCase uid fields, `exists` — and no `messages` object at all.
// The previous mock used node-imap's shape, which is why #138 slipped through.
const mailboxObject = (overrides: Record<string, unknown> = {}) => ({
  path: 'INBOX',
  delimiter: '/',
  flags: new Set(['\\Seen', '\\Flagged', '$cl_3']),
  permanentFlags: new Set(['\\Seen', '\\Flagged', '$cl_3', '\\*']),
  uidValidity: 1234567890n,
  uidNext: 456,
  exists: 21,
  ...overrides,
});

// ImapService.getFolderStatus already normalizes STATUS to plain numbers.
const folderStatus = (overrides: Record<string, number> = {}) => ({
  messages: 21,
  recent: 1,
  unseen: 2,
  uidValidity: 1234567890,
  uidNext: 456,
  ...overrides,
});

const runStatus = async () => {
  const result = await folderStatusHandler({ accountId: 'acc1', folder: 'INBOX' });
  return JSON.parse(result.content[0].text);
};

describe('imap_folder_status Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('derives customKeywords from mailbox flags, excluding system flags', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus());
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject());

    expect((await runStatus()).customKeywords).toEqual(['$cl_3']);
  });

  it('returns an empty customKeywords array when the mailbox has no custom keywords', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus({ messages: 0, recent: 0, unseen: 0 }));
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject({
      flags: new Set(['\\Seen', '\\Deleted']),
      permanentFlags: new Set(['\\Seen', '\\Deleted']),
    }));

    expect((await runStatus()).customKeywords).toEqual([]);
  });

  // Regression: the handler used to read node-imap's `box.messages.total`,
  // which imapflow never sets — every call threw "Cannot read properties of
  // undefined (reading 'total')" regardless of provider (#138).
  it('reports message counts from STATUS rather than the mailbox object', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus({ messages: 21, recent: 3, unseen: 7 }));
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject());

    expect((await runStatus()).messages).toEqual({ total: 21, new: 3, unseen: 7 });
  });

  it('reports uidvalidity and uidnext instead of dropping them', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus({ uidValidity: 1234567890, uidNext: 99 }));
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject());

    const parsed = await runStatus();
    expect(parsed.uidvalidity).toBe(1234567890);
    expect(parsed.uidnext).toBe(99);
  });

  // imapflow hands back Sets; JSON.stringify renders those as {}.
  it('serializes flag sets as arrays', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus());
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject());

    const parsed = await runStatus();
    expect(parsed.flags).toEqual(['\\Seen', '\\Flagged', '$cl_3']);
    expect(parsed.permanentFlags).toEqual(['\\Seen', '\\Flagged', '$cl_3', '\\*']);
  });

  it('tolerates a mailbox that omits permanentFlags', async () => {
    mockImapService.getFolderStatus.mockResolvedValueOnce(folderStatus());
    mockImapService.selectFolder.mockResolvedValueOnce(mailboxObject({ permanentFlags: undefined }));

    expect((await runStatus()).permanentFlags).toEqual([]);
  });

  // STATUS must precede SELECT — RFC 3501 discourages STATUS against the
  // currently selected mailbox.
  it('issues STATUS before SELECT', async () => {
    const order: string[] = [];
    mockImapService.getFolderStatus.mockImplementationOnce(async () => {
      order.push('status');
      return folderStatus();
    });
    mockImapService.selectFolder.mockImplementationOnce(async () => {
      order.push('select');
      return mailboxObject();
    });

    await runStatus();
    expect(order).toEqual(['status', 'select']);
  });
});

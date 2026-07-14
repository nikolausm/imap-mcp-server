import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

let findThreadMessagesHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_find_thread_messages') {
      findThreadMessagesHandler = handler;
    }
  }),
};

const mockImapService = {
  findThreadMessages: vi.fn(),
};

describe('imap_find_thread_messages Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any, {} as any);
  });

  it('should be registered', () => {
    expect(findThreadMessagesHandler).toBeDefined();
  });

  it('should return thread UIDs and counts on success', async () => {
    mockImapService.findThreadMessages.mockResolvedValueOnce({
      messageIds: ['<a@x>', '<b@x>'],
      uids: [100, 101, 102],
    });

    const result = await findThreadMessagesHandler({
      accountId: 'acc1',
      sourceFolder: 'Review',
      searchFolder: 'INBOX',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.sourceMessageIdCount).toBe(2);
    expect(parsed.threadMessageCount).toBe(3);
    expect(parsed.uids).toEqual([100, 101, 102]);
  });

  it('should pass searchReferences flag through to service', async () => {
    mockImapService.findThreadMessages.mockResolvedValueOnce({
      messageIds: [],
      uids: [],
    });

    await findThreadMessagesHandler({
      accountId: 'acc1',
      sourceFolder: 'Review',
      searchFolder: 'INBOX',
      searchReferences: false,
    });

    expect(mockImapService.findThreadMessages).toHaveBeenCalledWith(
      'acc1',
      'Review',
      'INBOX',
      expect.objectContaining({ searchReferences: false }),
    );
  });

  it('should return success:false when service throws', async () => {
    mockImapService.findThreadMessages.mockRejectedValueOnce(new Error('folder missing'));

    const result = await findThreadMessagesHandler({
      accountId: 'acc1',
      sourceFolder: 'Nope',
      searchFolder: 'INBOX',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('folder missing');
  });
});

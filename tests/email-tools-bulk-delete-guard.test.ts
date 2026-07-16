import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

// Capture the handler registered for imap_bulk_delete_by_search
let bulkDeleteBySearchHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_bulk_delete_by_search') {
      bulkDeleteBySearchHandler = handler;
    }
  }),
};

const mockImapService = {
  searchEmails: vi.fn(),
  bulkDelete: vi.fn(),
};

const mockAccountManager = { resolveAccountId: (id: string) => id ?? 'acc1' };
const mockSmtpService = {};

describe('imap_bulk_delete_by_search — empty-criteria guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  it('refuses to run when no criteria are given, and never touches the mailbox', async () => {
    const result = await bulkDeleteBySearchHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      chunkSize: 50,
      dryRun: false,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/criteria/i);
    // The whole point: no search, and above all no delete, may be issued.
    expect(mockImapService.searchEmails).not.toHaveBeenCalled();
    expect(mockImapService.bulkDelete).not.toHaveBeenCalled();
  });

  it('also refuses an empty-criteria dryRun (a preview must not imply a full wipe)', async () => {
    const result = await bulkDeleteBySearchHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      chunkSize: 50,
      dryRun: true,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(mockImapService.searchEmails).not.toHaveBeenCalled();
  });

  it('still runs when a concrete criterion is supplied', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([{ uid: 1, from: 'spam@x.com', subject: 'x', date: new Date() }]);
    mockImapService.bulkDelete.mockResolvedValueOnce({ deleted: 1, failed: 0, errors: [] });

    const result = await bulkDeleteBySearchHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      from: 'spam@x.com',
      chunkSize: 50,
      dryRun: false,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.deleted).toBe(1);
    expect(mockImapService.searchEmails).toHaveBeenCalledOnce();
    expect(mockImapService.bulkDelete).toHaveBeenCalledOnce();
  });
});

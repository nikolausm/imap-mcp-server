import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

// Capture the handler registered for imap_move_email
let moveEmailHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_move_email') {
      moveEmailHandler = handler;
    }
  }),
};

const mockImapService = {
  moveEmail: vi.fn(),
};

const mockAccountManager = {};
const mockSmtpService = {};

describe('imap_move_email Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  it('should be registered', () => {
    expect(moveEmailHandler).toBeDefined();
  });

  it('should return success with destination and uidMap', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Archive',
      uidMap: new Map([[100, 200]]),
    });

    const result = await moveEmailHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 100,
      targetFolder: 'Archive',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Email 100 moved from INBOX to Archive');
    expect(parsed.destination).toBe('Archive');
    expect(parsed.uidMap).toEqual({ '100': 200 });
  });

  it('should omit uidMap when not provided by server', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Taxes',
    });

    const result = await moveEmailHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 50,
      targetFolder: 'Taxes',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.uidMap).toBeUndefined();
  });

  it('should return success:false when moveEmail throws', async () => {
    mockImapService.moveEmail.mockRejectedValueOnce(
      new Error('Failed to move email UID 123 from INBOX to NonExistent')
    );

    const result = await moveEmailHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 123,
      targetFolder: 'NonExistent',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBe('Failed to move email 123 from INBOX to NonExistent');
    expect(parsed.error).toBe('Failed to move email UID 123 from INBOX to NonExistent');
  });

  it('should handle non-Error exceptions', async () => {
    mockImapService.moveEmail.mockRejectedValueOnce('string error');

    const result = await moveEmailHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      targetFolder: 'Trash',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Unknown error');
  });

  it('should serialize multiple uidMap entries correctly', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({
      path: 'INBOX',
      destination: 'Archive',
      uidMap: new Map([[10, 20], [30, 40], [50, 60]]),
    });

    const result = await moveEmailHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 10,
      targetFolder: 'Archive',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uidMap).toEqual({ '10': 20, '30': 40, '50': 60 });
  });
});

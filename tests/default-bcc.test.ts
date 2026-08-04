import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeBcc } from '../src/utils/default-bcc.js';
import { accountTools } from '../src/tools/account-tools.js';
import { emailTools } from '../src/tools/email-tools.js';

/**
 * Covers the defaultBcc account override — same plumbing shape as
 * account-tools-sent-folder.test.ts / email-tools-sent-save.test.ts.
 */
describe('mergeBcc', () => {
  it('returns undefined when neither side has addresses', () => {
    expect(mergeBcc(undefined, undefined)).toBeUndefined();
    expect(mergeBcc('', '')).toBeUndefined();
    expect(mergeBcc([], [])).toBeUndefined();
  });

  it('returns the explicit bcc alone when no default is set', () => {
    expect(mergeBcc(undefined, 'me@example.com')).toBe('me@example.com');
    expect(mergeBcc(undefined, ['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns the default alone when no explicit bcc is set', () => {
    expect(mergeBcc('me@example.com', undefined)).toBe('me@example.com');
  });

  it('merges explicit first, then defaults, and dedupes case-insensitively', () => {
    expect(mergeBcc('Me@Example.com', 'other@example.com')).toEqual([
      'other@example.com',
      'Me@Example.com',
    ]);
    expect(mergeBcc('me@example.com', 'ME@example.com')).toBe('ME@example.com');
  });

  it('dedupes display-name wrappers on the bare address', () => {
    expect(mergeBcc('me@example.com', 'Me <me@example.com>')).toBe('Me <me@example.com>');
  });
});

describe('account tools defaultBcc override', () => {
  let addAccountHandler: Function;
  let updateAccountHandler: Function;

  const mockServer = {
    registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
      if (name === 'imap_add_account') addAccountHandler = handler;
      if (name === 'imap_update_account') updateAccountHandler = handler;
    }),
  };

  const mockAccountManager = {
    addAccount: vi.fn(async (acc: any) => ({ ...acc, id: 'acc1' })),
    getAccount: vi.fn(() => ({ id: 'acc1', name: 'Test', host: 'imap.example.com' })),
    updateAccount: vi.fn(async (id: string, updates: any) => ({ id, name: 'Test', ...updates })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    accountTools(
      mockServer as any,
      mockAccountManager as any,
      {} as any,
      { disconnect: vi.fn() } as any,
    );
  });

  it('imap_add_account stores a defaultBcc override', async () => {
    await addAccountHandler({
      name: 'Test',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: 'pw',
      tls: true,
      defaultBcc: 'me@example.com',
    });

    expect(mockAccountManager.addAccount).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBcc: 'me@example.com' }),
    );
  });

  it('imap_add_account omits defaultBcc when not provided', async () => {
    await addAccountHandler({
      name: 'Test',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: 'pw',
      tls: true,
    });

    const stored = mockAccountManager.addAccount.mock.calls[0][0];
    expect('defaultBcc' in stored).toBe(false);
  });

  it('imap_add_account omits defaultBcc when passed an empty string', async () => {
    await addAccountHandler({
      name: 'Test',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: 'pw',
      tls: true,
      defaultBcc: '',
    });

    const stored = mockAccountManager.addAccount.mock.calls[0][0];
    expect('defaultBcc' in stored).toBe(false);
  });

  it('imap_update_account sets a defaultBcc override', async () => {
    await updateAccountHandler({ accountId: 'acc1', defaultBcc: 'archive@example.com' });

    expect(mockAccountManager.updateAccount).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ defaultBcc: 'archive@example.com' }),
    );
  });

  it('imap_update_account clears the override when given an empty string', async () => {
    await updateAccountHandler({ accountId: 'acc1', defaultBcc: '' });

    const updates = mockAccountManager.updateAccount.mock.calls[0][1];
    expect('defaultBcc' in updates).toBe(true);
    expect(updates.defaultBcc).toBeUndefined();
  });

  it('imap_update_account leaves defaultBcc untouched when not provided', async () => {
    await updateAccountHandler({ accountId: 'acc1', name: 'Renamed' });

    const updates = mockAccountManager.updateAccount.mock.calls[0][1];
    expect('defaultBcc' in updates).toBe(false);
  });
});

describe('imap_send_email defaultBcc', () => {
  let sendEmailHandler: Function;

  const mockServer = {
    registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
      if (name === 'imap_send_email') sendEmailHandler = handler;
    }),
  };

  const account: any = {
    id: 'acc1',
    name: 'Test',
    email: 'user@example.com',
    user: 'user@example.com',
    defaultBcc: 'archive@example.com',
    saveToSent: false,
  };

  const mockSmtpService = {
    sendEmail: vi.fn(async () => ({ messageId: '<msg-1@example.com>', rawMessage: 'RAW' })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      { appendToSentFolder: vi.fn() } as any,
      {
        resolveAccountId: (id: string) => id,
        getAccount: vi.fn(async () => account),
      } as any,
      mockSmtpService as any,
    );
  });

  it('injects defaultBcc when the call omits bcc', async () => {
    await sendEmailHandler({
      accountId: 'acc1',
      to: 'rcpt@example.com',
      subject: 'Hi',
      text: 'Hello',
    });

    expect(mockSmtpService.sendEmail).toHaveBeenCalledWith(
      'acc1',
      account,
      expect.objectContaining({ bcc: 'archive@example.com' }),
    );
  });

  it('merges call-site bcc with the account default', async () => {
    await sendEmailHandler({
      accountId: 'acc1',
      to: 'rcpt@example.com',
      subject: 'Hi',
      text: 'Hello',
      bcc: 'extra@example.com',
    });

    expect(mockSmtpService.sendEmail).toHaveBeenCalledWith(
      'acc1',
      account,
      expect.objectContaining({
        bcc: ['extra@example.com', 'archive@example.com'],
      }),
    );
  });
});

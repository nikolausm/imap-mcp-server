import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accountTools } from '../src/tools/account-tools.js';

/**
 * Covers the sentFolder override plumbing on imap_add_account /
 * imap_update_account (issue #125).
 */
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

const mockImapService = {};
const mockSmtpService = { disconnect: vi.fn() };

describe('account tools sentFolder override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountTools(
      mockServer as any,
      mockAccountManager as any,
      mockImapService as any,
      mockSmtpService as any,
    );
  });

  it('imap_add_account stores a sentFolder override', async () => {
    await addAccountHandler({
      name: 'Test',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: 'pw',
      tls: true,
      sentFolder: 'Gesendet',
    });

    expect(mockAccountManager.addAccount).toHaveBeenCalledWith(
      expect.objectContaining({ sentFolder: 'Gesendet' }),
    );
  });

  it('imap_add_account omits sentFolder when not provided', async () => {
    await addAccountHandler({
      name: 'Test',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: 'pw',
      tls: true,
    });

    const stored = mockAccountManager.addAccount.mock.calls[0][0];
    expect('sentFolder' in stored).toBe(false);
  });

  it('imap_update_account sets a sentFolder override', async () => {
    await updateAccountHandler({ accountId: 'acc1', sentFolder: '[Gmail]/Gesendet' });

    expect(mockAccountManager.updateAccount).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ sentFolder: '[Gmail]/Gesendet' }),
    );
  });

  it('imap_update_account clears the override when given an empty string', async () => {
    await updateAccountHandler({ accountId: 'acc1', sentFolder: '' });

    const updates = mockAccountManager.updateAccount.mock.calls[0][1];
    expect('sentFolder' in updates).toBe(true);
    expect(updates.sentFolder).toBeUndefined();
  });

  it('imap_update_account leaves sentFolder untouched when not provided', async () => {
    await updateAccountHandler({ accountId: 'acc1', name: 'Renamed' });

    const updates = mockAccountManager.updateAccount.mock.calls[0][1];
    expect('sentFolder' in updates).toBe(false);
  });
});

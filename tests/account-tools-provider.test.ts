import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { accountTools } from '../src/tools/account-tools.js';

/**
 * The optional per-account `provider` field (registry id), used by
 * provider-specific rules such as the imap_copy_email copy policy.
 */
const handlers: Record<string, Function> = {};
const schemas: Record<string, any> = {};

const mockServer = {
  registerTool: vi.fn((name: string, schema: any, handler: Function) => {
    handlers[name] = handler;
    schemas[name] = schema;
  }),
};

const accounts = [
  { id: 'p', name: 'Proton', host: 'protonmail-bridge', port: 143, user: 'u', tls: false, provider: 'protonmail' },
  { id: 'g', name: 'Gmail', host: 'imap.gmail.com', port: 993, user: 'u', tls: true },
  { id: 'x', name: 'Other', host: 'mail.example.com', port: 993, user: 'u', tls: true },
];

const mockAccountManager = {
  addAccount: vi.fn(async (acc: any) => ({ ...acc, id: 'new' })),
  getAccount: vi.fn(() => accounts[0]),
  getAllAccounts: vi.fn(() => accounts),
  updateAccount: vi.fn(async (id: string, updates: any) => ({ id, name: 'Test', ...updates })),
};

const base = { name: 'Test', host: 'protonmail-bridge', port: 143, user: 'u', password: 'pw', tls: false };

describe('account provider field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountTools(mockServer as any, mockAccountManager as any, {} as any, { disconnect: vi.fn() } as any);
  });

  it('imap_add_account stores an explicit provider', async () => {
    await handlers.imap_add_account({ ...base, provider: 'protonmail' });
    expect(mockAccountManager.addAccount).toHaveBeenCalledWith(expect.objectContaining({ provider: 'protonmail' }));
  });

  it('imap_add_account leaves provider unset when not given', async () => {
    await handlers.imap_add_account(base);
    expect(mockAccountManager.addAccount.mock.calls[0][0]).not.toHaveProperty('provider');
  });

  it('accepts registry ids only, never "custom"', () => {
    const provider = z.object(schemas.imap_add_account.inputSchema).shape.provider;
    expect(provider.safeParse('gmail').success).toBe(true);
    expect(provider.safeParse('protonmail').success).toBe(true);
    expect(provider.safeParse('custom').success).toBe(false);
    expect(provider.safeParse('proton').success).toBe(false);
  });

  it('imap_update_account sets and clears provider', async () => {
    await handlers.imap_update_account({ accountId: 'p', provider: 'gmail' });
    expect(mockAccountManager.updateAccount).toHaveBeenLastCalledWith('p', expect.objectContaining({ provider: 'gmail' }));

    await handlers.imap_update_account({ accountId: 'p', provider: '' });
    const cleared = mockAccountManager.updateAccount.mock.calls.at(-1)![1];
    expect(cleared).toHaveProperty('provider', undefined);
  });

  it('imap_list_accounts shows the provider in effect: explicit, by host, or null', async () => {
    const result = await handlers.imap_list_accounts({});
    const listed = JSON.parse(result.content[0].text).accounts;
    expect(listed.map((a: any) => [a.id, a.provider])).toEqual([
      ['p', 'protonmail'],
      ['g', 'gmail'],
      ['x', null],
    ]);
  });
});

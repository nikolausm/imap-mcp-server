import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock the file system for tests
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Need to import after mocking
import { AccountManager } from '../src/services/account-manager.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

describe('AccountManager', () => {
  const mockEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock encryption key file
    vi.mocked(readFileSync).mockReturnValue(mockEncryptionKey);

    // Mock accounts file not existing initially
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();

    // Remove any env-var overrides set by individual tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('IMAP_MCP_ACCOUNT_')) {
        delete process.env[key];
      }
    }
  });

  describe('constructor', () => {
    it('should create account manager with correct config path', () => {
      const manager = new AccountManager();
      expect(manager).toBeDefined();
    });

    it('should create encryption key if not exists', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const manager = new AccountManager();
      expect(manager).toBeDefined();
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe('addAccount', () => {
    it('should add account with generated id', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'Test Account',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret123',
        tls: true,
      });

      expect(account.id).toBeDefined();
      expect(account.name).toBe('Test Account');
      expect(account.host).toBe('imap.test.com');
      expect(account.user).toBe('user@test.com');
      expect(account.password).toBe('secret123'); // Returns unencrypted
    });

    it('should save accounts after adding', async () => {
      const manager = new AccountManager();

      await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should encrypt password when storing', async () => {
      const manager = new AccountManager();

      await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      // Check that writeFile was called with encrypted data
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedData = JSON.parse(writeCall[1] as string);

      // Password should be encrypted (contains :)
      expect(savedData[0].password).toContain(':');
      expect(savedData[0].password).not.toBe('secret');
    });

    it('should handle SMTP config with encrypted password', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'imapSecret',
        tls: true,
        smtp: {
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          password: 'smtpSecret',
        },
      });

      expect(account.smtp?.password).toBe('smtpSecret'); // Returns unencrypted
    });
  });

  describe('getAccount', () => {
    it('should return undefined for non-existent account', () => {
      const manager = new AccountManager();
      const account = manager.getAccount('non-existent-id');
      expect(account).toBeUndefined();
    });

    it('should return decrypted account', async () => {
      const manager = new AccountManager();

      const created = await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'mypassword',
        tls: true,
      });

      const retrieved = manager.getAccount(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.password).toBe('mypassword');
    });
  });

  describe('getAllAccounts', () => {
    it('should return empty array when no accounts', () => {
      const manager = new AccountManager();
      const accounts = manager.getAllAccounts();
      expect(accounts).toEqual([]);
    });

    it('should return all accounts with decrypted passwords', async () => {
      const manager = new AccountManager();

      await manager.addAccount({
        name: 'Account 1',
        host: 'imap1.test.com',
        port: 993,
        user: 'user1@test.com',
        password: 'pass1',
        tls: true,
      });

      await manager.addAccount({
        name: 'Account 2',
        host: 'imap2.test.com',
        port: 993,
        user: 'user2@test.com',
        password: 'pass2',
        tls: true,
      });

      const accounts = manager.getAllAccounts();

      expect(accounts.length).toBe(2);
      expect(accounts[0].password).toBe('pass1');
      expect(accounts[1].password).toBe('pass2');
    });
  });

  describe('getAccountByName', () => {
    it('should find account by name', async () => {
      const manager = new AccountManager();

      await manager.addAccount({
        name: 'My Email',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      const account = manager.getAccountByName('My Email');

      expect(account).toBeDefined();
      expect(account?.name).toBe('My Email');
    });

    it('should return undefined for non-existent name', () => {
      const manager = new AccountManager();
      const account = manager.getAccountByName('Non Existent');
      expect(account).toBeUndefined();
    });
  });

  describe('resolveAccountId', () => {
    const addOne = (manager: AccountManager, name: string) => manager.addAccount({
      name, host: 'imap.test.com', port: 993, user: `${name}@test.com`, password: 'pw', tls: true,
    });

    it('returns the id when an explicit accountId exists', async () => {
      const manager = new AccountManager();
      const created = await addOne(manager, 'A');
      expect(manager.resolveAccountId(created.id)).toBe(created.id);
    });

    it('throws for an unknown accountId', async () => {
      const manager = new AccountManager();
      await addOne(manager, 'A');
      expect(() => manager.resolveAccountId('nope')).toThrow(/not found/i);
    });

    it('resolves by accountName', async () => {
      const manager = new AccountManager();
      const created = await addOne(manager, 'Work');
      expect(manager.resolveAccountId(undefined, 'Work')).toBe(created.id);
    });

    it('throws for an unknown accountName', async () => {
      const manager = new AccountManager();
      await addOne(manager, 'Work');
      expect(() => manager.resolveAccountId(undefined, 'Home')).toThrow(/no account named/i);
    });

    it('defaults to the only account when none is specified', async () => {
      const manager = new AccountManager();
      const created = await addOne(manager, 'Solo');
      expect(manager.resolveAccountId()).toBe(created.id);
    });

    it('throws when no accounts are configured', () => {
      const manager = new AccountManager();
      expect(() => manager.resolveAccountId()).toThrow(/no accounts configured/i);
    });

    it('throws when multiple accounts exist and none is specified', async () => {
      const manager = new AccountManager();
      await addOne(manager, 'A');
      await addOne(manager, 'B');
      expect(() => manager.resolveAccountId()).toThrow(/multiple accounts/i);
    });
  });

  describe('environment variable credential overrides', () => {
    const addWork = (manager: AccountManager, name = 'Work Gmail') => manager.addAccount({
      name,
      host: 'imap.test.com',
      port: 993,
      user: 'stored-user@test.com',
      password: 'stored-pass',
      tls: true,
    });

    it('overrides IMAP user and password from env vars in getAccount', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME = 'env-user@test.com';
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();
      const created = await addWork(manager);

      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('env-user@test.com');
      expect(account?.password).toBe('env-pass');
    });

    it('normalizes the account name to build the env var prefix', async () => {
      process.env.IMAP_MCP_ACCOUNT_MY_WORK_ACCOUNT__IMAP_USERNAME = 'env@test.com';

      const manager = new AccountManager();
      const created = await manager.addAccount({
        name: 'My Work-Account!',
        host: 'imap.test.com',
        port: 993,
        user: 'stored@test.com',
        password: 'stored',
        tls: true,
      });

      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('env@test.com');
    });

    it('applies overrides in getAllAccounts and getAccountByName too', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();
      await addWork(manager);

      expect(manager.getAllAccounts()[0].password).toBe('env-pass');
      expect(manager.getAccountByName('Work Gmail')?.password).toBe('env-pass');
    });

    it('leaves fields untouched when no matching env var is set', async () => {
      const manager = new AccountManager();
      const created = await addWork(manager);

      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('stored-user@test.com');
      expect(account?.password).toBe('stored-pass');
    });

    it('overrides SMTP credentials separately when an smtp config exists', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME = 'env-imap@test.com';
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_USERNAME = 'env-smtp@test.com';
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_PASSWORD = 'env-smtp-pass';

      const manager = new AccountManager();
      const created = await manager.addAccount({
        name: 'Work Gmail',
        host: 'imap.test.com',
        port: 993,
        user: 'stored-user@test.com',
        password: 'stored-pass',
        tls: true,
        smtp: {
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          user: 'stored-smtp@test.com',
          password: 'stored-smtp-pass',
        },
      });

      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('env-imap@test.com');
      expect(account?.smtp?.user).toBe('env-smtp@test.com');
      expect(account?.smtp?.password).toBe('env-smtp-pass');
    });

    it('ignores SMTP env vars when the account has no smtp config', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_USERNAME = 'env-smtp@test.com';

      const manager = new AccountManager();
      const created = await addWork(manager);

      const account = manager.getAccount(created.id);
      expect(account?.smtp).toBeUndefined();
    });

    it('captures and removes the env vars from process.env in the constructor', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME = 'env-user@test.com';
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      // Construction alone consumes them — no getter call needed
      new AccountManager();

      expect(process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME).toBeUndefined();
      expect(process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD).toBeUndefined();
    });

    it('keeps applying the override after the env var is consumed', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();
      const created = await addWork(manager);

      // Env var already consumed at construction, override still applies on every read
      expect(process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD).toBeUndefined();
      expect(manager.getAccount(created.id)?.password).toBe('env-pass');
      expect(manager.getAccount(created.id)?.password).toBe('env-pass');
    });

    it('holds neither the cache key nor the value as plaintext', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();

      const cache = (manager as any).capturedEnvOverrides as Map<string, string>;
      expect(cache.size).toBe(1);

      // The plaintext variable name is not used as the key
      expect(cache.has('IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD')).toBe(false);

      const [key, value] = [...cache.entries()][0];
      expect(key).not.toContain('WORK_GMAIL'); // key does not leak the account name
      expect(value).not.toBe('env-pass'); // value is encrypted
      expect(value).toContain(':'); // iv:ciphertext form
    });

    it('does not persist env overrides to disk', async () => {
      process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();
      const created = await addWork(manager);

      manager.getAccount(created.id);

      // No write happened just from reading
      const writes = vi.mocked(fs.writeFile).mock.calls;
      const lastWrite = writes[writes.length - 1];
      const saved = JSON.parse(lastWrite[1] as string);
      expect(saved[0].password).not.toBe('env-pass');
    });

    it('round-trips an empty password placeholder added via addAccount', async () => {
      const manager = new AccountManager();

      const created = await manager.addAccount({
        name: 'Env Managed',
        host: 'imap.test.com',
        port: 993,
        user: '',
        password: '',
        tls: true,
      });

      // No decrypt crash; empty placeholders come back as empty strings
      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('');
      expect(account?.password).toBe('');
    });

    it('lets env vars fill an empty placeholder stored for an account', async () => {
      process.env.IMAP_MCP_ACCOUNT_ENV_MANAGED_IMAP_USERNAME = 'env-user@test.com';
      process.env.IMAP_MCP_ACCOUNT_ENV_MANAGED_IMAP_PASSWORD = 'env-pass';

      const manager = new AccountManager();
      const created = await manager.addAccount({
        name: 'Env Managed',
        host: 'imap.test.com',
        port: 993,
        user: '',
        password: '',
        tls: true,
      });

      const account = manager.getAccount(created.id);
      expect(account?.user).toBe('env-user@test.com');
      expect(account?.password).toBe('env-pass');
    });

    it('round-trips an empty password placeholder set via updateAccount', async () => {
      const manager = new AccountManager();

      const created = await manager.addAccount({
        name: 'Later Env Managed',
        host: 'imap.test.com',
        port: 993,
        user: 'stored-user@test.com',
        password: 'stored-pass',
        tls: true,
      });

      // Marking the field env-managed on edit stores an empty placeholder
      await manager.updateAccount(created.id, { password: '' });

      // Must not crash on decrypt; comes back as an empty string
      const account = manager.getAccount(created.id);
      expect(account?.password).toBe('');
    });
  });

  describe('malformed stored accounts', () => {
    // A stored account whose credentials were never written (null user/password)
    // must not crash listing — decrypt is called on the password unconditionally.
    const loadAccounts = (accounts: unknown[]) => {
      vi.mocked(readFileSync).mockImplementation(((p: any) => {
        if (String(p).endsWith('.key')) return mockEncryptionKey;
        return JSON.stringify(accounts);
      }) as any);
    };

    it('lists an account with a null password without throwing', () => {
      loadAccounts([
        { id: 'bad', name: 'Private', user: null, password: null, host: 'imap.mail.me.com', port: 993, tls: true },
      ]);

      const manager = new AccountManager();

      const accounts = manager.getAllAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Private');
      expect(accounts[0].password).toBe('');
    });

    it('returns an empty password for a null/blank stored value via getAccount / getAccountByName', () => {
      loadAccounts([
        { id: 'bad', name: 'Private', user: null, password: null, host: 'imap.mail.me.com', port: 993, tls: true },
      ]);

      const manager = new AccountManager();

      expect(manager.getAccount('bad')?.password).toBe('');
      expect(manager.getAccountByName('Private')?.password).toBe('');
    });

    it('returns an empty password for an empty-string stored value', () => {
      loadAccounts([
        { id: 'empty', name: 'Private', user: '', password: '', host: 'imap.mail.me.com', port: 993, tls: true },
      ]);

      const manager = new AccountManager();

      expect(manager.getAllAccounts()[0].password).toBe('');
      expect(manager.getAccount('empty')?.password).toBe('');
    });

    it('throws on a non-empty but malformed (unencrypted) IMAP password', () => {
      loadAccounts([
        { id: 'corrupt', name: 'Private', user: 'me', password: 'not-encrypted', host: 'imap.mail.me.com', port: 993, tls: true },
      ]);

      const manager = new AccountManager();

      expect(() => manager.getAllAccounts()).toThrow(/not a valid encrypted string/);
      expect(() => manager.getAccount('corrupt')).toThrow(/not a valid encrypted string/);
      expect(() => manager.getAccountByName('Private')).toThrow(/not a valid encrypted string/);
    });

    it('throws on a non-empty but malformed SMTP password', () => {
      loadAccounts([
        {
          id: 'corrupt-smtp', name: 'Private', user: 'me', password: '', host: 'imap.mail.me.com', port: 993, tls: true,
          smtp: { host: 'smtp.mail.me.com', port: 587, user: 'me', password: 'not-encrypted' },
        },
      ]);

      const manager = new AccountManager();

      expect(() => manager.getAllAccounts()).toThrow(/not a valid encrypted string/);
    });
  });

  describe('removeAccount', () => {
    it('should remove existing account', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'To Remove',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      await manager.removeAccount(account.id);

      const retrieved = manager.getAccount(account.id);
      expect(retrieved).toBeUndefined();
    });

    it('should throw error for non-existent account', async () => {
      const manager = new AccountManager();

      await expect(manager.removeAccount('non-existent')).rejects.toThrow(
        'Account non-existent not found'
      );
    });
  });

  describe('updateAccount', () => {
    it('should update account fields', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'Original Name',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      const updated = await manager.updateAccount(account.id, {
        name: 'New Name',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.host).toBe('imap.test.com'); // Unchanged
    });

    it('should encrypt new password on update', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'oldpass',
        tls: true,
      });

      const updated = await manager.updateAccount(account.id, {
        password: 'newpass',
      });

      expect(updated.password).toBe('newpass'); // Returns decrypted
    });

    it('should throw error for non-existent account', async () => {
      const manager = new AccountManager();

      await expect(
        manager.updateAccount('non-existent', { name: 'New' })
      ).rejects.toThrow('Account with id non-existent not found');
    });

    it('should preserve id on update', async () => {
      const manager = new AccountManager();

      const account = await manager.addAccount({
        name: 'Test',
        host: 'imap.test.com',
        port: 993,
        user: 'user@test.com',
        password: 'secret',
        tls: true,
      });

      const updated = await manager.updateAccount(account.id, {
        name: 'Updated',
      });

      expect(updated.id).toBe(account.id);
    });
  });
});

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

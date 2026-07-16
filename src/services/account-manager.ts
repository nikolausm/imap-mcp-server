import { promises as fs } from 'fs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ImapAccount } from '../types/index.js';

export class AccountManager {
  private configPath: string;
  private accounts: Map<string, ImapAccount> = new Map();
  private encryptionKey: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.imap-mcp', 'accounts.json');
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.loadAccountsSync();
  }

  async addAccount(account: Omit<ImapAccount, 'id'>): Promise<ImapAccount> {
    const id = crypto.randomUUID();
    const newAccount: ImapAccount = {
      ...account,
      id,
      password: this.encrypt(account.password),
    };

    // Encrypt SMTP password if provided
    if (account.smtp?.password) {
      newAccount.smtp = {
        ...account.smtp,
        password: this.encrypt(account.smtp.password),
      };
    }

    this.accounts.set(id, newAccount);
    await this.saveAccounts();
    
    return { ...newAccount, password: account.password, smtp: account.smtp };
  }


  async removeAccount(id: string): Promise<void> {
    if (!this.accounts.has(id)) {
      throw new Error(`Account ${id} not found`);
    }

    this.accounts.delete(id);
    await this.saveAccounts();
  }

  async updateAccount(id: string, updates: Partial<Omit<ImapAccount, 'id'>>): Promise<ImapAccount> {
    const existingAccount = this.accounts.get(id);
    if (!existingAccount) {
      throw new Error(`Account with id ${id} not found`);
    }

    // Encrypt password if it's being updated
    const processedUpdates = { ...updates };
    if (processedUpdates.password) {
      processedUpdates.password = this.encrypt(processedUpdates.password);
    }
    
    // Encrypt SMTP password if it's being updated
    if (processedUpdates.smtp?.password) {
      processedUpdates.smtp = {
        ...processedUpdates.smtp,
        password: this.encrypt(processedUpdates.smtp.password),
      };
    }

    // Merge updates with existing account
    const updatedAccount: ImapAccount = {
      ...existingAccount,
      ...processedUpdates,
      id, // Ensure ID doesn't change
    };

    this.accounts.set(id, updatedAccount);
    await this.saveAccounts();

    // Return decrypted version
    const decrypted: ImapAccount = {
      ...updatedAccount,
      password: this.decrypt(updatedAccount.password),
    };
    
    if (updatedAccount.smtp?.password) {
      decrypted.smtp = {
        ...updatedAccount.smtp,
        password: this.decrypt(updatedAccount.smtp.password),
      };
    }
    
    return decrypted;
  }

  getAccount(id: string): ImapAccount | undefined {
    this.loadAccountsSync();
    const account = this.accounts.get(id);
    if (!account) return undefined;

    const decrypted: ImapAccount = {
      ...account,
      password: this.decrypt(account.password),
    };
    
    if (account.smtp?.password) {
      decrypted.smtp = {
        ...account.smtp,
        password: this.decrypt(account.smtp.password),
      };
    }
    
    return decrypted;
  }

  getAllAccounts(): ImapAccount[] {
    return Array.from(this.accounts.values()).map(account => {
      const decrypted: ImapAccount = {
        ...account,
        password: this.decrypt(account.password),
      };
      
      if (account.smtp?.password) {
        decrypted.smtp = {
          ...account.smtp,
          password: this.decrypt(account.smtp.password),
        };
      }
      
      return decrypted;
    });
  }

  /**
   * Resolve which account a tool call refers to, in a backward-compatible way:
   *   1. explicit `accountId`        → must exist
   *   2. explicit `accountName`      → matched by name
   *   3. neither, and exactly ONE account configured → that account (default)
   * Throws a helpful, actionable error otherwise. Returns the account id.
   */
  resolveAccountId(accountId?: string, accountName?: string): string {
    this.loadAccountsSync();

    if (accountId) {
      if (!this.accounts.has(accountId)) {
        throw new Error(`Account ${accountId} not found. Use imap_list_accounts to see available accounts.`);
      }
      return accountId;
    }

    if (accountName) {
      const match = Array.from(this.accounts.values()).find(acc => acc.name === accountName);
      if (!match) {
        throw new Error(`No account named "${accountName}". Use imap_list_accounts to see available accounts.`);
      }
      return match.id;
    }

    const all = Array.from(this.accounts.values());
    if (all.length === 1) {
      return all[0].id;
    }
    if (all.length === 0) {
      throw new Error('No accounts configured. Add one with imap_add_account (or run the setup wizard).');
    }
    throw new Error(
      `Multiple accounts are configured (${all.length}). Specify accountId or accountName. Use imap_list_accounts to see them.`
    );
  }

  getAccountByName(name: string): ImapAccount | undefined {
    const account = Array.from(this.accounts.values()).find(acc => acc.name === name);
    if (!account) return undefined;

    const decrypted: ImapAccount = {
      ...account,
      password: this.decrypt(account.password),
    };
    
    if (account.smtp?.password) {
      decrypted.smtp = {
        ...account.smtp,
        password: this.decrypt(account.smtp.password),
      };
    }
    
    return decrypted;
  }

  private loadAccountsSync(): void {
    try {
      const data = readFileSync(this.configPath, 'utf-8');
      const accounts = JSON.parse(data) as ImapAccount[];

      this.accounts.clear();
      for (const account of accounts) {
        this.accounts.set(account.id, account);
      }
    } catch (error) {
      // File doesn't exist yet, that's okay
      if ((error as any).code !== 'ENOENT') {
        console.error('Error loading accounts:', error);
      }
    }
  }

  private async saveAccounts(): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const accounts = Array.from(this.accounts.values());
    await fs.writeFile(this.configPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });

    await this.enforceStorePermissions();
  }

  /**
   * Defence in depth for the credential store. `~/.imap-mcp/` holds the raw
   * AES-256 key and the (encrypted) accounts, so anyone able to read the key
   * plus the store can recover every password. The `mode` options above only
   * apply when a file is *created*; a store written before this hardening — or
   * under a permissive umask — could still be world-readable. Re-assert
   * owner-only permissions on the directory, the accounts file, and the key.
   * Best effort: silently ignored on platforms without POSIX modes (Windows)
   * or when a path does not exist yet.
   */
  private async enforceStorePermissions(): Promise<void> {
    if (process.platform === 'win32') return;

    const dir = path.dirname(this.configPath);
    const keyPath = path.join(dir, '.key');
    const targets: Array<[string, number]> = [
      [dir, 0o700],
      [this.configPath, 0o600],
      [keyPath, 0o600],
    ];

    for (const [target, mode] of targets) {
      try {
        await fs.chmod(target, mode);
      } catch {
        // best effort — path may not exist yet, or fs is stubbed in tests
      }
    }
  }

  private getOrCreateEncryptionKey(): string {
    const keyPath = path.join(os.homedir(), '.imap-mcp', '.key');
    
    try {
      return readFileSync(keyPath, 'utf-8');
    } catch {
      const key = crypto.randomBytes(32).toString('hex');
      // Owner-only from the moment of creation: the key alone can decrypt every
      // stored credential (see enforceStorePermissions).
      mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
      writeFileSync(keyPath, key, { mode: 0o600 });
      return key;
    }
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(text: string): string {
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
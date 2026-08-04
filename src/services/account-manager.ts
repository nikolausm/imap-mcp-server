import { promises as fs } from 'fs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ImapAccount } from '../types/index.js';
import { ENV_CREDENTIAL_SUFFIXES, envVarName } from '../utils/env-credentials.js';

export class AccountManager {
  private configPath: string;
  private accounts: Map<string, ImapAccount> = new Map();
  private encryptionKey: string;
  private capturedEnvOverrides: Map<string, string> = new Map();

  private static readonly ENV_OVERRIDE_PATTERN =
    /^IMAP_MCP_ACCOUNT_.+_(?:IMAP|SMTP)_(?:USERNAME|PASSWORD)$/;

  constructor() {
    this.configPath = path.join(os.homedir(), '.imap-mcp', 'accounts.json');
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.captureEnvOverrides();
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

    // Encrypt password if it's being updated. Use an explicit undefined check so
    // an empty placeholder ("" — used for env-managed credentials) is encrypted
    // to a decryptable value rather than stored raw.
    const processedUpdates = { ...updates };
    if (processedUpdates.password !== undefined) {
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
      password: this.decryptField(account.password),
    };

    if (account.smtp?.password) {
      decrypted.smtp = {
        ...account.smtp,
        password: this.decryptField(account.smtp.password),
      };
    }

    return this.applyEnvOverrides(decrypted);
  }

  /**
   * Override IMAP/SMTP credentials from environment variables, keyed by the
   * account's normalized name. This lets credentials be supplied at runtime
   * (e.g. from a secret manager) instead of the encrypted `accounts.json`.
   *
   *   IMAP_MCP_ACCOUNT_<NAME>_IMAP_USERNAME  -> user
   *   IMAP_MCP_ACCOUNT_<NAME>_IMAP_PASSWORD  -> password
   *   IMAP_MCP_ACCOUNT_<NAME>_SMTP_USERNAME  -> smtp.user  (only if smtp exists)
   *   IMAP_MCP_ACCOUNT_<NAME>_SMTP_PASSWORD  -> smtp.password (only if smtp exists)
   *
   * <NAME> is the account name uppercased with every non-alphanumeric character
   * replaced by "_". Overrides are applied in-memory only; nothing is written
   * back to disk. A variable takes effect only when it was present at startup.
   *
   * The values themselves are captured once in the constructor (see
   * `captureEnvOverrides`) and served here from the encrypted cache.
   */
  private applyEnvOverrides(account: ImapAccount): ImapAccount {
    const varName = (suffix: string) => envVarName(account.name, suffix);

    const result: ImapAccount = { ...account };

    const imapUser = this.getEnvOverride(varName(ENV_CREDENTIAL_SUFFIXES.imapUser));
    if (imapUser !== undefined) {
      result.user = imapUser;
    }

    const imapPassword = this.getEnvOverride(varName(ENV_CREDENTIAL_SUFFIXES.imapPassword));
    if (imapPassword !== undefined) {
      result.password = imapPassword;
    }

    if (result.smtp) {
      const smtpUser = this.getEnvOverride(varName(ENV_CREDENTIAL_SUFFIXES.smtpUser));
      const smtpPassword = this.getEnvOverride(varName(ENV_CREDENTIAL_SUFFIXES.smtpPassword));

      if (smtpUser !== undefined || smtpPassword !== undefined) {
        result.smtp = { ...result.smtp };
        if (smtpUser !== undefined) {
          result.smtp.user = smtpUser;
        }
        if (smtpPassword !== undefined) {
          result.smtp.password = smtpPassword;
        }
      }
    }

    return result;
  }

  /**
   * Capture every `IMAP_MCP_ACCOUNT_*_(IMAP|SMTP)_(USERNAME|PASSWORD)` variable
   * into an encrypted in-memory cache and delete it from `process.env`. Run once
   * in the constructor so the plaintext secrets do not linger in the process
   * environment (where they could leak to child processes or diagnostics) any
   * longer than necessary. `Object.entries` snapshots the keys, so deleting
   * during iteration is safe.
   */
  private captureEnvOverrides(): void {
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined && AccountManager.ENV_OVERRIDE_PATTERN.test(name)) {
        this.capturedEnvOverrides.set(this.hashCacheKey(name), this.encrypt(value));
        delete process.env[name];
      }
    }
  }

  /**
   * Return a captured override value by variable name, decrypting it from the
   * cache. Returns `undefined` when no such variable was present at startup.
   */
  private getEnvOverride(name: string): string | undefined {
    const encrypted = this.capturedEnvOverrides.get(this.hashCacheKey(name));
    if (encrypted === undefined) {
      return undefined;
    }
    return this.decrypt(encrypted);
  }

  /**
   * Derive a deterministic, non-reversible cache key from a variable name via
   * HMAC-SHA256 keyed by the encryption key. Keeps the account name (embedded in
   * the variable name) out of the in-memory cache in plaintext while still
   * allowing lookups.
   */
  private hashCacheKey(name: string): string {
    return crypto
      .createHmac('sha256', Buffer.from(this.encryptionKey, 'hex'))
      .update(name)
      .digest('hex');
  }

  getAllAccounts(): ImapAccount[] {
    return Array.from(this.accounts.values()).map(account => {
      const decrypted: ImapAccount = {
        ...account,
        password: this.decryptField(account.password),
      };

      if (account.smtp?.password) {
        decrypted.smtp = {
          ...account.smtp,
          password: this.decryptField(account.smtp.password),
        };
      }

      return this.applyEnvOverrides(decrypted);
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
      password: this.decryptField(account.password),
    };

    if (account.smtp?.password) {
      decrypted.smtp = {
        ...account.smtp,
        password: this.decryptField(account.smtp.password),
      };
    }

    return this.applyEnvOverrides(decrypted);
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

  /**
   * Decrypt a stored credential field.
   *
   * A missing or empty value (null, undefined, or "") is treated as "no
   * credential" and returns an empty string — the env-override mechanism can
   * still fill it at runtime. A non-empty value that is not a well-formed
   * encrypted string (missing the "iv:ciphertext" separator, or otherwise
   * undecryptable) is a corrupt entry and throws, rather than being silently
   * swallowed.
   */
  private decryptField(value: string | null | undefined): string {
    if (value === undefined || value === null || value === '') {
      return '';
    }
    if (typeof value !== 'string' || !value.includes(':')) {
      throw new Error('Cannot decrypt credential field: value is not a valid encrypted string');
    }
    return this.decrypt(value);
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
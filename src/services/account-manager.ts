import { promises as fs } from 'fs';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ImapAccount } from '../types/index.js';
import { ENV_CREDENTIAL_SUFFIXES, envVarName, envAccountKey } from '../utils/env-credentials.js';
import {
  classifyCiphertext,
  decryptAesCbc,
  decryptAesGcm,
  encryptAesGcm,
  fieldAad,
} from '../credentials/crypto.js';
import {
  STORE_DEK_NAME,
  accountSecretName,
  deleteKeyringSecret,
  getKeyringSecret,
  isKeyringAvailable,
  setKeyringSecret,
} from '../credentials/keyring.js';
import {
  VaultEnvConfig,
  captureAndScrubVaultAuthEnv,
  loadVaultConfigFromEnv,
  readVaultKvField,
} from '../credentials/vault.js';

type SecretField = 'password' | 'smtp.password' | 'user' | 'smtp.user';

export class AccountManager {
  private configPath: string;
  private accounts: Map<string, ImapAccount> = new Map();
  /** 32-byte DEK used for AES-GCM. */
  private encryptionKey: Buffer;
  /** Separate HMAC key derived from the DEK (purpose separation). */
  private hmacKey: Buffer;
  /** Hex form of legacy CBC key when a co-located `.key` is in use / being migrated. */
  private legacyKeyHex: string | null = null;
  private capturedEnvOverrides: Map<string, string> = new Map();
  private vaultAuthEnv: Map<string, string> = new Map();
  private vaultConfig: VaultEnvConfig | null = null;
  private keySource: 'keyring' | 'file' | 'ephemeral' = 'file';
  private hydratePromise: Promise<void> | null = null;

  private static readonly ENV_OVERRIDE_PATTERN =
    /^IMAP_MCP_ACCOUNT_.+_(?:IMAP|SMTP)_(?:USERNAME|PASSWORD)$/;

  constructor() {
    this.configPath = path.join(os.homedir(), '.imap-mcp', 'accounts.json');
    this.vaultAuthEnv = captureAndScrubVaultAuthEnv();
    this.vaultConfig = loadVaultConfigFromEnv(this.vaultAuthEnv);
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.hmacKey = Buffer.from(crypto.hkdfSync('sha256', this.encryptionKey, Buffer.alloc(0), 'imap-mcp-env-cache-hmac-v1', 32));
    this.emitCryptoNotice();
    this.captureEnvOverrides();
    this.loadAccountsSync();
  }

  /**
   * Pull keyring + vault secrets into the encrypted in-memory override cache.
   * Call once at process startup (before serving MCP tools). Safe to call
   * repeatedly; concurrent callers share one in-flight promise.
   */
  async hydrateExternalCredentials(): Promise<void> {
    if (!this.hydratePromise) {
      this.hydratePromise = this.doHydrateExternalCredentials().finally(() => {
        // keep resolved promise so later awaits are no-ops
      });
    }
    return this.hydratePromise;
  }

  private async doHydrateExternalCredentials(): Promise<void> {
    for (const account of this.accounts.values()) {
      await this.hydrateAccount(account);
    }
  }

  private async hydrateAccount(account: ImapAccount): Promise<void> {
    const fields: Array<{
      suffix: string;
      vaultField: string;
      keyringField: 'imap-password' | 'smtp-password' | 'imap-user' | 'smtp-user';
      secretField: SecretField;
    }> = [
      {
        suffix: ENV_CREDENTIAL_SUFFIXES.imapUser,
        vaultField: `${envAccountKey(account.name)}_IMAP_USERNAME`,
        keyringField: 'imap-user',
        secretField: 'user',
      },
      {
        suffix: ENV_CREDENTIAL_SUFFIXES.imapPassword,
        vaultField: `${envAccountKey(account.name)}_IMAP_PASSWORD`,
        keyringField: 'imap-password',
        secretField: 'password',
      },
      {
        suffix: ENV_CREDENTIAL_SUFFIXES.smtpUser,
        vaultField: `${envAccountKey(account.name)}_SMTP_USERNAME`,
        keyringField: 'smtp-user',
        secretField: 'smtp.user',
      },
      {
        suffix: ENV_CREDENTIAL_SUFFIXES.smtpPassword,
        vaultField: `${envAccountKey(account.name)}_SMTP_PASSWORD`,
        keyringField: 'smtp-password',
        secretField: 'smtp.password',
      },
    ];

    for (const field of fields) {
      const envName = envVarName(account.name, field.suffix);
      if (this.capturedEnvOverrides.has(this.hashCacheKey(envName))) {
        continue; // env already won
      }

      // Vault only when the account explicitly opts in — mere VAULT_ADDR /
      // IMAP_MCP_VAULT_PATH must not ambiently reroute every account (Muse).
      const preferVault =
        account.credentialSource === 'vault' || !!account.vaultPath;

      if (preferVault && this.vaultConfig) {
        const vaultPath = account.vaultPath || this.vaultConfig.path;
        if (vaultPath) {
          try {
            const value = await readVaultKvField(this.vaultConfig, vaultPath, field.vaultField);
            if (value !== undefined) {
              this.capturedEnvOverrides.set(this.hashCacheKey(envName), this.encrypt(value, 'env', envName));
              continue;
            }
          } catch (err) {
            console.error(
              `[imap-mcp] Vault credential lookup failed for account "${account.name}" field ${field.vaultField}: ${
                err instanceof Error ? err.message : 'unknown error'
              }`,
            );
          }
        }
      }

      if (account.credentialSource === 'vault' && !preferVault) {
        // fall through to keyring/file
      }

      const fromKeyring = getKeyringSecret(accountSecretName(account.id, field.keyringField));
      if (fromKeyring !== undefined) {
        this.capturedEnvOverrides.set(this.hashCacheKey(envName), this.encrypt(fromKeyring, 'env', envName));
      }
    }
  }

  private emitCryptoNotice(): void {
    if (process.env.IMAP_MCP_SILENCE_CRYPTO_NOTICE || process.env.VITEST) return;
    const parts = [
      `[imap-mcp] Credential resolution: env overrides > vault (when configured) > OS keyring > encrypted file store.`,
      `File-store DEK source: ${this.keySource}.`,
    ];
    if (this.keySource === 'file') {
      parts.push(
        'Co-located ~/.imap-mcp/.key is obfuscation at rest — prefer OS keyring or Vault/OpenBao. Set IMAP_MCP_SILENCE_CRYPTO_NOTICE=1 to hide this notice.',
      );
    }
    if (this.vaultConfig?.skipVerify) {
      parts.push('WARNING: VAULT_SKIP_VERIFY/BAO_SKIP_VERIFY=1 disables TLS verification for vault.');
    }
    console.error(parts.join(' '));
  }

  async addAccount(account: Omit<ImapAccount, 'id'>): Promise<ImapAccount> {
    const id = crypto.randomUUID();
    const credentialSource = account.credentialSource ?? this.defaultWriteSource();

    let password = account.password;
    let smtpPassword = account.smtp?.password;
    let storedPassword = '';
    let storedSmtpPassword: string | undefined;
    let source = credentialSource;

    if (source === 'keyring' || (source !== 'env' && source !== 'vault' && isKeyringAvailable())) {
      const ok =
        setKeyringSecret(accountSecretName(id, 'imap-password'), password) &&
        (account.user
          ? setKeyringSecret(accountSecretName(id, 'imap-user'), account.user)
          : true) &&
        (smtpPassword === undefined ||
          setKeyringSecret(accountSecretName(id, 'smtp-password'), smtpPassword));
      if (ok) {
        source = 'keyring';
        storedPassword = this.encrypt('', id, 'password');
        if (smtpPassword !== undefined) {
          storedSmtpPassword = this.encrypt('', id, 'smtp.password');
        }
        // Keep plaintext returns; cache for immediate use
        const imapEnv = envVarName(account.name, ENV_CREDENTIAL_SUFFIXES.imapPassword);
        this.setOverrideIfAbsent(imapEnv, password);
        if (smtpPassword !== undefined) {
          const smtpEnv = envVarName(account.name, ENV_CREDENTIAL_SUFFIXES.smtpPassword);
          this.setOverrideIfAbsent(smtpEnv, smtpPassword);
        }
      } else if (source === 'keyring') {
        // fall back to file
        source = 'file';
      }
    }

    if (source !== 'keyring') {
      storedPassword = this.encrypt(password, id, 'password');
      if (smtpPassword !== undefined) {
        storedSmtpPassword = this.encrypt(smtpPassword, id, 'smtp.password');
      }
      if (source !== 'env' && source !== 'vault') source = 'file';
    }

    const newAccount: ImapAccount = {
      ...account,
      id,
      password: storedPassword,
      credentialSource: source,
    };

    if (account.smtp) {
      newAccount.smtp = {
        ...account.smtp,
        password: storedSmtpPassword ?? (account.smtp.password !== undefined
          ? this.encrypt(account.smtp.password, id, 'smtp.password')
          : account.smtp.password),
      };
    }

    this.accounts.set(id, newAccount);
    await this.saveAccounts();

    return { ...newAccount, password: account.password, smtp: account.smtp, credentialSource: source };
  }

  private defaultWriteSource(): 'keyring' | 'file' | 'env' | 'vault' {
    if (isKeyringAvailable()) return 'keyring';
    return 'file';
  }

  async removeAccount(id: string): Promise<void> {
    if (!this.accounts.has(id)) {
      throw new Error(`Account ${id} not found`);
    }
    for (const field of ['imap-password', 'smtp-password', 'imap-user', 'smtp-user'] as const) {
      deleteKeyringSecret(accountSecretName(id, field));
    }
    this.accounts.delete(id);
    await this.saveAccounts();
  }

  async updateAccount(id: string, updates: Partial<Omit<ImapAccount, 'id'>>): Promise<ImapAccount> {
    const existingAccount = this.accounts.get(id);
    if (!existingAccount) {
      throw new Error(`Account with id ${id} not found`);
    }

    const processedUpdates = { ...updates };
    const source = updates.credentialSource ?? existingAccount.credentialSource ?? 'file';

    if (processedUpdates.password !== undefined) {
      if (source === 'keyring' && setKeyringSecret(accountSecretName(id, 'imap-password'), processedUpdates.password)) {
        processedUpdates.password = this.encrypt('', id, 'password');
        const imapEnv = envVarName(existingAccount.name, ENV_CREDENTIAL_SUFFIXES.imapPassword);
        this.capturedEnvOverrides.set(this.hashCacheKey(imapEnv), this.encrypt(updates.password!, 'env', imapEnv));
      } else {
        processedUpdates.password = this.encrypt(processedUpdates.password, id, 'password');
      }
    }

    if (processedUpdates.smtp?.password !== undefined) {
      const smtpPass = processedUpdates.smtp.password;
      if (source === 'keyring' && setKeyringSecret(accountSecretName(id, 'smtp-password'), smtpPass)) {
        processedUpdates.smtp = {
          ...processedUpdates.smtp,
          password: this.encrypt('', id, 'smtp.password'),
        };
        const smtpEnv = envVarName(existingAccount.name, ENV_CREDENTIAL_SUFFIXES.smtpPassword);
        this.capturedEnvOverrides.set(this.hashCacheKey(smtpEnv), this.encrypt(smtpPass, 'env', smtpEnv));
      } else {
        processedUpdates.smtp = {
          ...processedUpdates.smtp,
          password: this.encrypt(smtpPass, id, 'smtp.password'),
        };
      }
    }

    const updatedAccount: ImapAccount = {
      ...existingAccount,
      ...processedUpdates,
      id,
      credentialSource: source,
    };

    this.accounts.set(id, updatedAccount);
    await this.saveAccounts();

    return this.getAccount(id)!;
  }

  getAccount(id: string): ImapAccount | undefined {
    this.loadAccountsSync();
    const account = this.accounts.get(id);
    if (!account) return undefined;
    return this.applyOverrides(this.decryptAccount(account));
  }

  private decryptAccount(account: ImapAccount): ImapAccount {
    const decrypted: ImapAccount = {
      ...account,
      password: this.decryptField(account.password, account.id, 'password'),
    };
    if (account.smtp?.password !== undefined && account.smtp.password !== null) {
      decrypted.smtp = {
        ...account.smtp,
        password: this.decryptField(account.smtp.password, account.id, 'smtp.password'),
      };
    }
    return decrypted;
  }

  private applyOverrides(account: ImapAccount): ImapAccount {
    const varName = (suffix: string) => envVarName(account.name, suffix);
    const result: ImapAccount = { ...account };

    const imapUser = this.getOverride(varName(ENV_CREDENTIAL_SUFFIXES.imapUser));
    if (imapUser !== undefined) result.user = imapUser;

    const imapPassword = this.getOverride(varName(ENV_CREDENTIAL_SUFFIXES.imapPassword));
    if (imapPassword !== undefined) result.password = imapPassword;

    if (result.smtp) {
      const smtpUser = this.getOverride(varName(ENV_CREDENTIAL_SUFFIXES.smtpUser));
      const smtpPassword = this.getOverride(varName(ENV_CREDENTIAL_SUFFIXES.smtpPassword));
      if (smtpUser !== undefined || smtpPassword !== undefined) {
        result.smtp = { ...result.smtp };
        if (smtpUser !== undefined) result.smtp.user = smtpUser;
        if (smtpPassword !== undefined) result.smtp.password = smtpPassword;
      }
    }
    return result;
  }

  private captureEnvOverrides(): void {
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined && AccountManager.ENV_OVERRIDE_PATTERN.test(name)) {
        // Env-cache AAD is keyed by variable name (no account id yet at capture).
        this.capturedEnvOverrides.set(this.hashCacheKey(name), this.encrypt(value, 'env', name));
        delete process.env[name];
      }
    }
  }

  private getOverride(name: string): string | undefined {
    const encrypted = this.capturedEnvOverrides.get(this.hashCacheKey(name));
    if (encrypted === undefined) return undefined;
    return this.decrypt(encrypted, 'env', name);
  }

  /** Do not clobber env-captured secrets when later writing keyring/file credentials. */
  private setOverrideIfAbsent(name: string, value: string): void {
    const key = this.hashCacheKey(name);
    if (this.capturedEnvOverrides.has(key)) return;
    this.capturedEnvOverrides.set(key, this.encrypt(value, 'env', name));
  }

  private hashCacheKey(name: string): string {
    return crypto.createHmac('sha256', this.hmacKey).update(name).digest('hex');
  }

  getAllAccounts(): ImapAccount[] {
    return Array.from(this.accounts.values()).map((account) =>
      this.applyOverrides(this.decryptAccount(account)),
    );
  }

  resolveAccountId(accountId?: string, accountName?: string): string {
    this.loadAccountsSync();

    if (accountId) {
      if (!this.accounts.has(accountId)) {
        throw new Error(`Account ${accountId} not found. Use imap_list_accounts to see available accounts.`);
      }
      return accountId;
    }

    if (accountName) {
      const match = Array.from(this.accounts.values()).find((acc) => acc.name === accountName);
      if (!match) {
        throw new Error(`No account named "${accountName}". Use imap_list_accounts to see available accounts.`);
      }
      return match.id;
    }

    const all = Array.from(this.accounts.values());
    if (all.length === 1) return all[0].id;
    if (all.length === 0) {
      throw new Error('No accounts configured. Add one with imap_add_account (or run the setup wizard).');
    }
    throw new Error(
      `Multiple accounts are configured (${all.length}). Specify accountId or accountName. Use imap_list_accounts to see them.`,
    );
  }

  getAccountByName(name: string): ImapAccount | undefined {
    const account = Array.from(this.accounts.values()).find((acc) => acc.name === name);
    if (!account) return undefined;
    return this.applyOverrides(this.decryptAccount(account));
  }

  /**
   * Migrate legacy AES-CBC fields to AES-GCM. Rewrites accounts.json atomically.
   * Does not delete `.key` — operator should remove it after confirming success.
   */
  async migrateLegacyCiphertext(): Promise<{ migratedFields: number; accounts: number }> {
    if (!this.legacyKeyHex) {
      return { migratedFields: 0, accounts: this.accounts.size };
    }
    let migratedFields = 0;
    for (const account of this.accounts.values()) {
      const kind = classifyCiphertext(account.password);
      if (kind === 'cbc-v0') {
        const plain = decryptAesCbc(account.password, this.legacyKeyHex);
        account.password = encryptAesGcm(plain, this.encryptionKey, fieldAad(account.id, 'password'));
        migratedFields++;
      }
      if (account.smtp?.password) {
        const smtpKind = classifyCiphertext(account.smtp.password);
        if (smtpKind === 'cbc-v0') {
          const plain = decryptAesCbc(account.smtp.password, this.legacyKeyHex);
          account.smtp = {
            ...account.smtp,
            password: encryptAesGcm(plain, this.encryptionKey, fieldAad(account.id, 'smtp.password')),
          };
          migratedFields++;
        }
      }
      this.accounts.set(account.id, account);
    }
    if (migratedFields > 0) {
      await this.saveAccountsAtomic();
    }
    return { migratedFields, accounts: this.accounts.size };
  }

  private loadAccountsSync(): void {
    try {
      const data = readFileSync(this.configPath, 'utf-8');
      const accounts = JSON.parse(data) as ImapAccount[];
      this.accounts.clear();
      for (const account of accounts) {
        this.accounts.set(account.id, account);
      }
      if (process.env.IMAP_MCP_MIGRATE_CREDENTIALS === '1') {
        // Fire-and-forget migration; errors logged. Prefer explicit CLI for production.
        void this.migrateLegacyCiphertext().catch((err) => {
          console.error('[imap-mcp] Credential migration failed:', err instanceof Error ? err.message : err);
        });
      }
    } catch (error) {
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

  private async saveAccountsAtomic(): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.configPath}.tmp-${process.pid}`;
    const accounts = Array.from(this.accounts.values());
    await fs.writeFile(tmp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    renameSync(tmp, this.configPath);
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
    for (const [target, mode] of [
      [dir, 0o700],
      [this.configPath, 0o600],
      [keyPath, 0o600],
    ] as Array<[string, number]>) {
      try {
        await fs.chmod(target, mode);
      } catch {
        // best effort
      }
    }
  }

  private getOrCreateEncryptionKey(): Buffer {
    // 1) OS keyring DEK (preferred)
    const fromKeyring = getKeyringSecret(STORE_DEK_NAME);
    if (fromKeyring) {
      const buf = Buffer.from(fromKeyring, 'hex');
      if (buf.length === 32) {
        this.keySource = 'keyring';
        // Legacy .key may still exist for CBC migration
        const keyPath = path.join(os.homedir(), '.imap-mcp', '.key');
        try {
          this.legacyKeyHex = readFileSync(keyPath, 'utf-8').trim();
        } catch {
          this.legacyKeyHex = null;
        }
        return buf;
      }
    }

    // 2) Co-located .key (legacy / ALLOW_FILE_KEY / headless fallback)
    const keyPath = path.join(os.homedir(), '.imap-mcp', '.key');
    try {
      const hex = readFileSync(keyPath, 'utf-8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) {
        this.legacyKeyHex = hex;
        this.keySource = 'file';
        // Promote into keyring when possible so future runs stop relying on co-location
        if (isKeyringAvailable()) {
          if (setKeyringSecret(STORE_DEK_NAME, hex)) {
            this.keySource = 'keyring';
          }
        }
        return buf;
      }
    } catch {
      // create below
    }

    const key = crypto.randomBytes(32);
    const hex = key.toString('hex');

    if (isKeyringAvailable() && setKeyringSecret(STORE_DEK_NAME, hex)) {
      this.keySource = 'keyring';
      this.legacyKeyHex = null;
      return key;
    }

    // File fallback for environments without a keyring (CI, tests, headless).
    // Operators who care should set IMAP_MCP_ALLOW_FILE_KEY explicitly; we still
    // create `.key` for backward compatibility but document the weakness.
    if (process.env.IMAP_MCP_ALLOW_FILE_KEY === '0') {
      this.keySource = 'ephemeral';
      this.legacyKeyHex = null;
      return key;
    }

    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, hex, { mode: 0o600 });
    this.legacyKeyHex = hex;
    this.keySource = 'file';
    return key;
  }

  private encrypt(text: string, accountId: string, field: string): string {
    return encryptAesGcm(text, this.encryptionKey, fieldAad(accountId, field));
  }

  private decryptField(value: string | null | undefined, accountId: string, field: string): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
      throw new Error('Cannot decrypt credential field: value is not a valid encrypted string');
    }
    const kind = classifyCiphertext(value);
    if (kind === 'unknown') {
      throw new Error('Cannot decrypt credential field: value is not a valid encrypted string');
    }
    if (kind === 'empty') return '';
    return this.decrypt(value, accountId, field);
  }

  private decrypt(text: string, accountId: string, field: string): string {
    const kind = classifyCiphertext(text);
    if (kind === 'gcm-v1') {
      return decryptAesGcm(text, this.encryptionKey, fieldAad(accountId, field));
    }
    if (kind === 'cbc-v0') {
      if (!this.legacyKeyHex) {
        // Same key material may be the DEK hex when keySource is file
        const hex = this.encryptionKey.toString('hex');
        return decryptAesCbc(text, hex);
      }
      return decryptAesCbc(text, this.legacyKeyHex);
    }
    throw new Error('Cannot decrypt credential field: value is not a valid encrypted string');
  }
}

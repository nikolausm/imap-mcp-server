/**
 * Database Service for IMAP MCP Pro
 *
 * Provides SQLite3 database operations with encryption at rest for sensitive data.
 * Supports MSP multi-tenant architecture with user-scoped data access.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 1.0.0
 * Date: 2025-11-05
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  User,
  Account,
  DecryptedAccount,
  UserAccount,
  Contact,
  Rule,
  SpamDomain,
  SpamCache,
  UnsubscribeLink,
  AuditLog,
  DatabaseConfig,
  EncryptedData
} from '../types/database-types.js';

export class DatabaseService {
  private db: Database.Database;
  private encryptionKey: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor(config?: Partial<DatabaseConfig>) {
    const dbPath = config?.dbPath || path.join(os.homedir(), '.imap-mcp', 'data.db');
    const dbDir = path.dirname(dbPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath, {
      verbose: config?.verbose ? console.log : undefined
    });

    // Set up encryption key
    this.encryptionKey = this.getOrCreateEncryptionKey(dbDir);

    // Initialize schema
    this.initializeSchema();

    console.error('[DatabaseService] Initialized at:', dbPath);
  }

  /**
   * Get or create encryption key for AES-256-GCM
   */
  private getOrCreateEncryptionKey(dbDir: string): Buffer {
    const keyPath = path.join(dbDir, '.encryption-key');

    if (fs.existsSync(keyPath)) {
      // Read existing key
      const keyHex = fs.readFileSync(keyPath, 'utf-8').trim();
      return Buffer.from(keyHex, 'hex');
    }

    // Generate new 256-bit key
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    console.error('[DatabaseService] Generated new encryption key');
    return key;
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  private encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = (cipher as any).getAuthTag();

    return {
      encrypted: encrypted + authTag.toString('hex'),
      iv: iv.toString('hex')
    };
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   */
  private decrypt(encrypted: string, ivHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');

    // Extract auth tag (last 16 bytes = 32 hex chars)
    const authTag = Buffer.from(encrypted.slice(-32), 'hex');
    const ciphertext = encrypted.slice(0, -32);

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    (decipher as any).setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    const schemaPath = path.join(__dirname, '../database/schema.sql');

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema (split by statement)
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        this.db.exec(statement);
      } catch (error) {
        console.error('[DatabaseService] Schema error:', error);
      }
    }

    console.error('[DatabaseService] Schema initialized');
  }

  // ===================
  // User Management
  // ===================

  createUser(user: Omit<User, 'created_at' | 'updated_at'>): User {
    const stmt = this.db.prepare(`
      INSERT INTO users (user_id, username, email, organization, is_active, metadata)
      VALUES (@user_id, @username, @email, @organization, @is_active, @metadata)
    `);

    stmt.run({
      user_id: user.user_id,
      username: user.username,
      email: user.email || null,
      organization: user.organization || null,
      is_active: user.is_active ? 1 : 0,
      metadata: user.metadata || null
    });

    return this.getUser(user.user_id)!;
  }

  getUser(userId: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE user_id = ?');
    const user = stmt.get(userId) as User | undefined;
    return user || null;
  }

  getUserByUsername(username: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    const user = stmt.get(username) as User | undefined;
    return user || null;
  }

  listUsers(): User[] {
    const stmt = this.db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY username');
    return stmt.all() as User[];
  }

  updateUser(userId: string, updates: Partial<User>): void {
    const fields: string[] = [];
    const values: any = { user_id: userId };

    if (updates.username !== undefined) {
      fields.push('username = @username');
      values.username = updates.username;
    }
    if (updates.email !== undefined) {
      fields.push('email = @email');
      values.email = updates.email;
    }
    if (updates.organization !== undefined) {
      fields.push('organization = @organization');
      values.organization = updates.organization;
    }
    if (updates.is_active !== undefined) {
      fields.push('is_active = @is_active');
      values.is_active = updates.is_active ? 1 : 0;
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = @metadata');
      values.metadata = updates.metadata;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const stmt = this.db.prepare(`
      UPDATE users SET ${fields.join(', ')} WHERE user_id = @user_id
    `);

    stmt.run(values);
  }

  deleteUser(userId: string): void {
    const stmt = this.db.prepare('DELETE FROM users WHERE user_id = ?');
    stmt.run(userId);
  }

  // ===================
  // Account Management
  // ===================

  createAccount(account: Omit<DecryptedAccount, 'account_id' | 'created_at' | 'updated_at' | 'last_connected'>): Account {
    const accountId = crypto.randomUUID();

    // Encrypt password
    const passwordData = this.encrypt(account.password);

    // Encrypt SMTP password if provided
    let smtpPasswordData: EncryptedData | null = null;
    if (account.smtp_password) {
      smtpPasswordData = this.encrypt(account.smtp_password);
    }

    const stmt = this.db.prepare(`
      INSERT INTO accounts (
        account_id, user_id, name, host, port, username,
        password_encrypted, encryption_iv, tls,
        smtp_host, smtp_port, smtp_secure, smtp_username,
        smtp_password_encrypted, smtp_encryption_iv, is_active
      ) VALUES (
        @account_id, @user_id, @name, @host, @port, @username,
        @password_encrypted, @encryption_iv, @tls,
        @smtp_host, @smtp_port, @smtp_secure, @smtp_username,
        @smtp_password_encrypted, @smtp_encryption_iv, @is_active
      )
    `);

    stmt.run({
      account_id: accountId,
      user_id: account.user_id,
      name: account.name,
      host: account.host,
      port: account.port,
      username: account.username,
      password_encrypted: passwordData.encrypted,
      encryption_iv: passwordData.iv,
      tls: account.tls ? 1 : 0,
      smtp_host: account.smtp_host || null,
      smtp_port: account.smtp_port || null,
      smtp_secure: account.smtp_secure ? 1 : 0,
      smtp_username: account.smtp_username || null,
      smtp_password_encrypted: smtpPasswordData?.encrypted || null,
      smtp_encryption_iv: smtpPasswordData?.iv || null,
      is_active: 1
    });

    // Create owner relationship
    this.linkUserToAccount(account.user_id, accountId, 'owner');

    return this.getAccount(accountId)!;
  }

  getAccount(accountId: string): Account | null {
    const stmt = this.db.prepare('SELECT * FROM accounts WHERE account_id = ?');
    const account = stmt.get(accountId) as Account | undefined;
    return account || null;
  }

  getDecryptedAccount(accountId: string): DecryptedAccount | null {
    const account = this.getAccount(accountId);
    if (!account) return null;

    // Decrypt password
    const password = this.decrypt(account.password_encrypted, account.encryption_iv);

    // Decrypt SMTP password if present
    let smtpPassword: string | undefined;
    if (account.smtp_password_encrypted && account.smtp_encryption_iv) {
      smtpPassword = this.decrypt(account.smtp_password_encrypted, account.smtp_encryption_iv);
    }

    return {
      account_id: account.account_id,
      user_id: account.user_id,
      name: account.name,
      host: account.host,
      port: account.port,
      username: account.username,
      password,
      tls: account.tls,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_secure: account.smtp_secure,
      smtp_username: account.smtp_username,
      smtp_password: smtpPassword,
      created_at: account.created_at,
      updated_at: account.updated_at,
      last_connected: account.last_connected,
      is_active: account.is_active
    };
  }

  listAccountsForUser(userId: string): Account[] {
    const stmt = this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN user_accounts ua ON a.account_id = ua.account_id
      WHERE ua.user_id = ? AND a.is_active = 1
      ORDER BY a.name
    `);

    return stmt.all(userId) as Account[];
  }

  listDecryptedAccountsForUser(userId: string): DecryptedAccount[] {
    const accounts = this.listAccountsForUser(userId);
    return accounts.map(account => this.getDecryptedAccount(account.account_id)!).filter(Boolean);
  }

  updateAccount(accountId: string, updates: Partial<DecryptedAccount>): void {
    const fields: string[] = [];
    const values: any = { account_id: accountId };

    if (updates.name !== undefined) {
      fields.push('name = @name');
      values.name = updates.name;
    }
    if (updates.host !== undefined) {
      fields.push('host = @host');
      values.host = updates.host;
    }
    if (updates.port !== undefined) {
      fields.push('port = @port');
      values.port = updates.port;
    }
    if (updates.username !== undefined) {
      fields.push('username = @username');
      values.username = updates.username;
    }
    if (updates.password !== undefined) {
      const passwordData = this.encrypt(updates.password);
      fields.push('password_encrypted = @password_encrypted');
      fields.push('encryption_iv = @encryption_iv');
      values.password_encrypted = passwordData.encrypted;
      values.encryption_iv = passwordData.iv;
    }
    if (updates.tls !== undefined) {
      fields.push('tls = @tls');
      values.tls = updates.tls ? 1 : 0;
    }
    if (updates.smtp_password !== undefined) {
      const smtpPasswordData = this.encrypt(updates.smtp_password);
      fields.push('smtp_password_encrypted = @smtp_password_encrypted');
      fields.push('smtp_encryption_iv = @smtp_encryption_iv');
      values.smtp_password_encrypted = smtpPasswordData.encrypted;
      values.smtp_encryption_iv = smtpPasswordData.iv;
    }
    if (updates.is_active !== undefined) {
      fields.push('is_active = @is_active');
      values.is_active = updates.is_active ? 1 : 0;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const stmt = this.db.prepare(`
      UPDATE accounts SET ${fields.join(', ')} WHERE account_id = @account_id
    `);

    stmt.run(values);
  }

  updateLastConnected(accountId: string): void {
    const stmt = this.db.prepare('UPDATE accounts SET last_connected = CURRENT_TIMESTAMP WHERE account_id = ?');
    stmt.run(accountId);
  }

  deleteAccount(accountId: string): void {
    const stmt = this.db.prepare('DELETE FROM accounts WHERE account_id = ?');
    stmt.run(accountId);
  }

  // ===================
  // User-Account Links
  // ===================

  linkUserToAccount(userId: string, accountId: string, role: 'owner' | 'admin' | 'user' | 'readonly' = 'user'): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_accounts (user_id, account_id, role)
      VALUES (?, ?, ?)
    `);

    stmt.run(userId, accountId, role);
  }

  unlinkUserFromAccount(userId: string, accountId: string): void {
    const stmt = this.db.prepare('DELETE FROM user_accounts WHERE user_id = ? AND account_id = ?');
    stmt.run(userId, accountId);
  }

  getUserAccountRole(userId: string, accountId: string): string | null {
    const stmt = this.db.prepare('SELECT role FROM user_accounts WHERE user_id = ? AND account_id = ?');
    const result = stmt.get(userId, accountId) as { role: string } | undefined;
    return result?.role || null;
  }

  // ===================
  // Close Database
  // ===================

  close(): void {
    this.db.close();
    console.error('[DatabaseService] Database closed');
  }
}

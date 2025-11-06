-- IMAP MCP Pro Database Schema
-- Version: 1.0.0
-- Author: Colin Bitterfield
-- Email: colin.bitterfield@templeofepiphany.com
-- Date: 2025-11-05
--
-- This schema supports MSP (Managed Service Provider) multi-tenant architecture
-- with encryption at rest for sensitive data.

-- Database metadata and versioning
CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

INSERT OR IGNORE INTO schema_version (version, description)
VALUES ('1.0.0', 'Initial schema with MSP multi-tenant support');

-- Users/Organizations for MSP architecture
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  organization TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  metadata TEXT -- JSON field for additional user data
);

CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- IMAP Email Accounts (migrated from JSON storage)
-- Passwords are encrypted at rest using AES-256-GCM
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL, -- Encrypted with AES-256-GCM
  encryption_iv TEXT NOT NULL, -- Initialization vector for decryption
  tls BOOLEAN DEFAULT 1,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure BOOLEAN,
  smtp_username TEXT,
  smtp_password_encrypted TEXT, -- Encrypted with AES-256-GCM
  smtp_encryption_iv TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_connected TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- User-Account access control with roles
CREATE TABLE IF NOT EXISTS user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT CHECK(role IN ('owner', 'admin', 'user', 'readonly')) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  UNIQUE(user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_user ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_account ON user_accounts(account_id);

-- Contact management (auto-learned from emails)
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER DEFAULT 1,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen DESC);

-- Email filtering rules (user-scoped)
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT, -- NULL = applies to all accounts
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  pattern_type TEXT CHECK(pattern_type IN ('from', 'to', 'subject', 'body', 'header')) NOT NULL,
  action TEXT CHECK(action IN ('move', 'copy', 'mark_read', 'mark_unread', 'mark_spam', 'delete', 'flag')) NOT NULL,
  target_folder TEXT,
  enabled BOOLEAN DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_executed TIMESTAMP,
  execution_count INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_account ON rules(account_id);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);

-- Spam domain cache (global, shared across all users)
CREATE TABLE IF NOT EXISTS spam_domains (
  domain TEXT PRIMARY KEY,
  spam_score REAL CHECK(spam_score >= 0 AND spam_score <= 1) NOT NULL,
  is_spam BOOLEAN NOT NULL,
  last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  check_count INTEGER DEFAULT 1,
  api_source TEXT, -- e.g., 'cleantalk', 'spamhaus'
  api_response TEXT, -- JSON response from API
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spam_domains_checked ON spam_domains(last_checked DESC);
CREATE INDEX IF NOT EXISTS idx_spam_domains_expires ON spam_domains(expires_at);

-- Spam cache for email content hashes (global)
CREATE TABLE IF NOT EXISTS spam_cache (
  email_hash TEXT PRIMARY KEY,
  spam_score REAL CHECK(spam_score >= 0 AND spam_score <= 1) NOT NULL,
  is_spam BOOLEAN NOT NULL,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  api_source TEXT,
  sender_email TEXT,
  subject TEXT
);

CREATE INDEX IF NOT EXISTS idx_spam_cache_expires ON spam_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_spam_cache_sender ON spam_cache(sender_email);

-- Unsubscribe links (for Issue #15)
CREATE TABLE IF NOT EXISTS unsubscribe_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT,
  unsubscribe_link TEXT,
  list_unsubscribe_header TEXT,
  message_date TIMESTAMP,
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  UNIQUE(account_id, folder, uid)
);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_user ON unsubscribe_links(user_id);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_sender ON unsubscribe_links(sender_email);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_extracted ON unsubscribe_links(extracted_at DESC);

-- Audit log for security and compliance
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  account_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT, -- JSON field
  ip_address TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

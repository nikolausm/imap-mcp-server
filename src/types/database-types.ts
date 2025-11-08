/**
 * Database Types for IMAP MCP Pro
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 1.0.0
 * Date: 2025-11-05
 */

export interface User {
  user_id: string;
  username: string;
  email?: string;
  organization?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  metadata?: string; // JSON string
}

export interface Account {
  account_id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password_encrypted: string;
  encryption_iv: string;
  tls: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_username?: string;
  smtp_password_encrypted?: string;
  smtp_encryption_iv?: string;
  created_at: string;
  updated_at: string;
  last_connected?: string;
  is_active: boolean;
}

export interface DecryptedAccount {
  account_id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string; // Decrypted
  tls: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_username?: string;
  smtp_password?: string; // Decrypted
  created_at: string;
  updated_at: string;
  last_connected?: string;
  is_active: boolean;
}

export interface UserAccount {
  id: number;
  user_id: string;
  account_id: string;
  role: 'owner' | 'admin' | 'user' | 'readonly';
  created_at: string;
}

export interface Contact {
  id: number;
  user_id: string;
  email: string;
  name?: string;
  first_seen: string;
  last_seen: string;
  message_count: number;
  notes?: string;
}

export interface Rule {
  id: number;
  user_id: string;
  account_id?: string;
  name: string;
  pattern: string;
  pattern_type: 'from' | 'to' | 'subject' | 'body' | 'header';
  action: 'move' | 'copy' | 'mark_read' | 'mark_unread' | 'mark_spam' | 'delete' | 'flag';
  target_folder?: string;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
  last_executed?: string;
  execution_count: number;
}

export interface SpamDomain {
  domain: string;
  spam_score: number;
  is_spam: boolean;
  last_checked: string;
  check_count: number;
  api_source?: string;
  api_response?: string;
  expires_at: string;
}

export interface SpamCache {
  email_hash: string;
  spam_score: number;
  is_spam: boolean;
  checked_at: string;
  expires_at: string;
  api_source?: string;
  sender_email?: string;
  subject?: string;
}

export interface UnsubscribeLink {
  id: number;
  user_id: string;
  account_id: string;
  folder: string;
  uid: number;
  sender_email: string;
  subject?: string;
  unsubscribe_link?: string;
  list_unsubscribe_header?: string;
  message_date?: string;
  extracted_at: string;
}

export interface SubscriptionSummary {
  id: number;
  user_id: string;
  sender_email: string;
  sender_domain: string;
  sender_name?: string;
  total_emails: number;
  first_seen: string;
  last_seen: string;
  unsubscribe_link?: string;
  unsubscribe_method?: 'http' | 'mailto' | 'both';
  unsubscribed: boolean;
  unsubscribed_at?: string;
  category: 'marketing' | 'newsletter' | 'promotional' | 'transactional' | 'other';
  notes?: string;
}

export interface AuditLog {
  id: number;
  user_id?: string;
  account_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: string; // JSON string
  ip_address?: string;
  timestamp: string;
}

export interface SchemaVersion {
  version: string;
  applied_at: string;
  description?: string;
}

export interface DatabaseConfig {
  dbPath: string;
  encryptionKey: string; // 32-byte hex string for AES-256
  verbose?: boolean;
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
}

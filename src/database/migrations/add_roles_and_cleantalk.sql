-- Migration: Add user roles and CleanTalk API keys table
-- Version: 1.1.0
-- Date: 2025-11-06
-- Author: Colin Bitterfield
--
-- This migration adds:
-- 1. Role/group column to users table (admin, user)
-- 2. CleanTalk API keys table for per-user SPAM detection

-- Add role column to existing users table (if not exists)
-- SQLite doesn't support ALTER TABLE ADD COLUMN with CHECK constraint directly,
-- so we need to handle this carefully

-- Step 1: Check if role column exists, if not add it
-- Note: This will be handled by the migration script in database-service.ts

-- For new installations, the schema.sql will include these changes
-- For existing installations, we need to migrate

-- Add role column (default to 'user')
-- ALTER TABLE users ADD COLUMN role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user';

-- Update existing 'default' user to be admin
-- UPDATE users SET role = 'admin' WHERE username = 'default';

-- Create CleanTalk keys table
CREATE TABLE IF NOT EXISTS cleantalk_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  daily_limit INTEGER DEFAULT 1000,
  daily_usage INTEGER DEFAULT 0,
  usage_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, api_key)
);

CREATE INDEX IF NOT EXISTS idx_cleantalk_user ON cleantalk_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_cleantalk_active ON cleantalk_keys(is_active);

-- Update schema version
INSERT OR REPLACE INTO schema_version (version, description)
VALUES ('1.1.0', 'Added user roles (admin/user) and CleanTalk API keys table');

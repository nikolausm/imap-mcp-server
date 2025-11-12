-- Schema update from 1.5.0 to 1.6.0
-- Add categories table for email organization

-- Categories for email filtering/organization
CREATE TABLE IF NOT EXISTS categories (
  category_id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  UNIQUE(category_name, account_id)
);

CREATE INDEX IF NOT EXISTS idx_categories_account ON categories(account_id);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(category_name);

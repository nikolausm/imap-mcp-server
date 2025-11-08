-- Schema Migration: 1.0.0 to 1.1.0
-- Date: 2025-11-07
-- Description: Add subscription_summary table for Issue #45 Phase 4
-- Author: Colin Bitterfield
-- Email: colin.bitterfield@templeofepiphany.com

-- Update schema version
UPDATE schema_version SET version = '1.1.0', description = 'Add subscription management tables', applied_at = CURRENT_TIMESTAMP
WHERE version = '1.0.0';

INSERT OR IGNORE INTO schema_version (version, description)
VALUES ('1.1.0', 'Add subscription management tables');

-- Subscription summary (aggregated view for Issue #45 Phase 4)
CREATE TABLE IF NOT EXISTS subscription_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_domain TEXT NOT NULL,
  sender_name TEXT,
  total_emails INTEGER DEFAULT 1,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  unsubscribe_link TEXT,
  unsubscribe_method TEXT CHECK(unsubscribe_method IN ('http', 'mailto', 'both')),
  unsubscribed BOOLEAN DEFAULT 0,
  unsubscribed_at TIMESTAMP,
  category TEXT CHECK(category IN ('marketing', 'newsletter', 'promotional', 'transactional', 'other')) DEFAULT 'other',
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, sender_email)
);

CREATE INDEX IF NOT EXISTS idx_subscription_user ON subscription_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_sender ON subscription_summary(sender_email);
CREATE INDEX IF NOT EXISTS idx_subscription_domain ON subscription_summary(sender_domain);
CREATE INDEX IF NOT EXISTS idx_subscription_category ON subscription_summary(category);
CREATE INDEX IF NOT EXISTS idx_subscription_unsubscribed ON subscription_summary(unsubscribed);

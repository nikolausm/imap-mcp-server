-- Schema Migration: 1.1.0 to 1.2.0
-- Date: 2025-11-07
-- Description: Add unsubscribe execution tracking columns (Issue #47)

-- Add columns for unsubscribe execution tracking
ALTER TABLE subscription_summary ADD COLUMN unsubscribe_attempted_at TIMESTAMP;
ALTER TABLE subscription_summary ADD COLUMN unsubscribe_result TEXT CHECK(unsubscribe_result IN ('success', 'failed', 'error'));
ALTER TABLE subscription_summary ADD COLUMN unsubscribe_error TEXT;

-- Update schema version
UPDATE schema_version SET version = '1.2.0', description = 'Add unsubscribe execution tracking', applied_at = CURRENT_TIMESTAMP
WHERE version = '1.1.0';

INSERT OR IGNORE INTO schema_version (version, description)
VALUES ('1.2.0', 'Add unsubscribe execution tracking');

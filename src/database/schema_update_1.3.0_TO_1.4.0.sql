-- Migration: 1.3.0 to 1.4.0
-- Add DNS Firewall cache for domain validation (Issue #59)

-- DNS Firewall cache table
CREATE TABLE IF NOT EXISTS dns_firewall_cache (
  domain TEXT PRIMARY KEY,
  is_safe BOOLEAN NOT NULL,
  is_blocked BOOLEAN NOT NULL,
  provider TEXT NOT NULL DEFAULT 'quad9',
  checked_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_dns_cache_expires ON dns_firewall_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_dns_cache_domain ON dns_firewall_cache(domain);

-- Note: Cache TTL defaults to 24 hours (86400000 ms)
-- Expired entries should be cleaned up periodically

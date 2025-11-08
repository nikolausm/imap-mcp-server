-- Migration: 1.4.0 to 1.5.0
-- Add DNS Firewall provider configuration table (Issue #60)

-- DNS Firewall providers configuration table
CREATE TABLE IF NOT EXISTS dns_firewall_providers (
  provider_id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('dns-over-https', 'dns-lookup')),
  api_endpoint TEXT,
  api_key TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_dns_providers_enabled ON dns_firewall_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_dns_providers_default ON dns_firewall_providers(is_default);

-- Seed with Quad9 as the default provider
INSERT INTO dns_firewall_providers (
  provider_id,
  provider_name,
  provider_type,
  api_endpoint,
  api_key,
  is_enabled,
  is_default,
  timeout_ms,
  created_at,
  updated_at,
  metadata
) VALUES (
  'quad9',
  'Quad9',
  'dns-over-https',
  'dns.quad9.net',
  NULL,
  1,
  1,
  5000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  '{"description":"Quad9 DNS-over-HTTPS threat intelligence service"}'
);

-- Ensure only one provider can be default at a time
CREATE TRIGGER IF NOT EXISTS ensure_single_default_provider
BEFORE UPDATE ON dns_firewall_providers
WHEN NEW.is_default = 1 AND OLD.is_default = 0
BEGIN
  UPDATE dns_firewall_providers SET is_default = 0 WHERE provider_id != NEW.provider_id;
END;

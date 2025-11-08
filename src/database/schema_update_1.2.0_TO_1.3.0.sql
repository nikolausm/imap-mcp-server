-- Migration: 1.2.0 to 1.3.0
-- Add IMAP server capabilities storage (Issue #58)
-- RFC 9051: Auto-detect and store server capabilities for runtime feature detection

-- Add capabilities column to store JSON-serialized ServerCapabilities
ALTER TABLE accounts ADD COLUMN capabilities TEXT;

-- Add timestamp for when capabilities were last queried
ALTER TABLE accounts ADD COLUMN capabilities_updated_at INTEGER;

-- Note: capabilities will be NULL until first connection/test
-- capabilities_updated_at stores Unix timestamp (ms since epoch)

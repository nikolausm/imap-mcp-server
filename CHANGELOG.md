# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-18

### Security
- **Fixed all high severity vulnerabilities** (Issue #1)
  - Replaced `node-imap` with `imapflow` - a modern, actively maintained IMAP library
  - Updated `@modelcontextprotocol/sdk` to v1.25.1
  - Updated `body-parser` and `nodemailer` to patched versions
  - Result: 0 vulnerabilities (was 3 high)

### Fixed
- **IMAP disconnect during deletion** (Issue #3)
  - Added connection state tracking with automatic reconnection
  - Implemented retry logic with max 3 attempts
  - Added error and close event handlers for proactive disconnect detection
  - All IMAP operations now use `ensureConnected()` before execution

### Added
- **Test account without re-entering password** (Issue #4)
  - New MCP tool: `imap_test_account` - validates stored account connectivity
  - New API endpoint: `POST /api/accounts/:id/test` - test existing account connection
  - Returns: success status, folder list, INBOX message count

- **Bulk delete functionality** (Issue #5 Enhancement 1)
  - New MCP tool: `imap_bulk_delete` - delete multiple emails by UID array
  - New MCP tool: `imap_bulk_delete_by_search` - delete emails matching search criteria
  - Features:
    - Chunked processing (configurable, default 50 per batch)
    - Auto-reconnection between chunks
    - Dry-run mode for preview
    - Progress tracking

- **Spam domain checking** (Issue #5 Enhancement 2)
  - New service: `SpamService` with 50+ known spam/disposable email domains
  - New MCP tools:
    - `imap_check_spam` - analyze emails for spam domains
    - `imap_delete_spam` - delete spam with confidence filtering
    - `imap_domain_stats` - sender domain statistics
    - `imap_add_spam_domain` / `imap_remove_spam_domain` - manage custom spam list
    - `imap_add_whitelist_domain` - whitelist trusted domains
    - `imap_list_spam_domains` - list all known spam domains
    - `imap_delete_by_domain` - delete all emails from a specific domain
  - Suspicious pattern detection (random long domains, phishing patterns)
  - Optional IPQualityScore API integration (via `IPQUALITYSCORE_API_KEY` env var)

- **Test suite** (74 tests)
  - Unit tests for `SpamService` (24 tests)
  - Unit tests for `AccountManager` (18 tests)
  - Unit tests for `ImapService` (17 tests)
  - Integration tests for tools and providers (15 tests)
  - Vitest configuration with coverage reporting

- **CI/CD Pipeline**
  - GitHub Actions workflow for self-hosted runners
  - Multi-version Node.js testing (18.x, 20.x, 22.x)
  - Automated security auditing
  - Build verification
  - Coverage reporting

### Changed
- Migrated IMAP library from `node-imap` to `imapflow`
- Switched build system from `tsc` to `esbuild` for faster builds
- Added new npm scripts: `test`, `test:watch`, `test:coverage`, `lint`

### Dependencies
- Added: `imapflow@^1.2.1`
- Added (dev): `vitest@^4.0.16`, `@vitest/coverage-v8@^4.0.16`, `esbuild@^0.27.2`
- Removed: `node-imap`, `@types/node-imap`
- Updated: `@modelcontextprotocol/sdk@^1.25.1`, `body-parser@^2.2.0`, `mailparser@^3.7.4`

## [1.0.0] - 2024-11-04

### Added
- Initial release
- IMAP email integration with Claude via MCP
- Account management (add, remove, list accounts)
- Email operations (search, read, delete, mark as read/unread)
- Folder operations (list, select folders)
- SMTP support for sending emails
- Web UI for account setup
- Email provider auto-detection (Gmail, Outlook, Yahoo, etc.)

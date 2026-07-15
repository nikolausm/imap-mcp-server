# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `includeBody` option on `imap_search_emails`, `imap_get_latest_emails`, and `imap_find_thread_messages` (#106). When set, the response includes the parsed body alongside the existing headers in a single tool call — no more N+1 round-trips of `search → N × imap_get_email`. Backed by three new optional params: `includeBody` (default false), `bodyFormat` (`markdown`/`text`/`html`/`auto`, default `markdown`), `bodyMaxLength` (per-field cap, default 10000). The body-rendering path is shared with `imap_get_email` via a refactored `buildEmailContentFromSource` helper. **Documented limitation:** `includeBody` is honored on the single-folder search path only; the cross-folder path keeps the lightweight header shape to avoid multiplying source-byte fetches across folders — follow up with `imap_get_email` for the specific uids whose bodies you need.
- Batch UID support on `imap_move_email`, `imap_mark_as_read`, and `imap_mark_as_unread` (#106). `uid` now accepts either a single UID or an array of UIDs. Batch moves go through a single `imap_move` per UID with per-uid results attributed in the response; batch flag operations use one IMAP STORE sequence-set (atomic at the server level). Single-UID callers see the legacy response shape unchanged.
- New `SearchOptions` interface in `src/types/index.ts` (with `DEFAULT_BODY_MAX_LENGTH` / `DEFAULT_BODY_FORMAT` constants) so search-criteria and output-shaping options stay cleanly separated.

### Fixed
- `imap_search_emails` single-folder path now returns the **newest** matches when `limit` cuts the result (#107). The service returns UIDs in ascending order (oldest first), and the tool used to `slice(0, limit)` directly, so callers received the oldest matches. Sort by `internalDate` DESC before applying `limit`, matching the cross-folder search path. Tests in `tests/email-tools-search-all.test.ts`.
- `imap-setup` CLI no longer crashes with `SyntaxError: Invalid regular expression flags` on Node 18 (#108). The crash was triggered transitively by `ora@9` → `string-width@8.2.1`, which uses the regex `/v` flag (Unicode set mode, requires Node ≥20). Pinned `string-width` to `^7.2.0` via npm `overrides`; tests in `tests/dependencies.test.ts` walk `node_modules` to ensure no transitive copy of `string-width@8.x` sneaks back in.

### Tests
- New `tests/email-tools-include-body-and-batch.test.ts` (14 cases) covering backwards compat + `includeBody` propagation + body-format options + batch UID happy path and partial failure. Existing `tests/email-tools-search-all.test.ts` and `tests/email-tools-thread.test.ts` updated to match the new option-arg shapes.

## [1.5.0] - 2026-06-27

### Added
- `imap_search_emails` cross-folder search (based on #92 by @jrejaud). New optional `searchAllFolders` flag scans every selectable mailbox at once — catching messages filed away by rules into custom folders — instead of only `folder`. Trash/Spam/Drafts and non-selectable (`\Noselect`) folders are skipped by default and can be opted back in via `includeTrash`/`includeSpam`/`includeDrafts`. Noisy folders are detected via RFC 6154 SPECIAL-USE flags with a name-based fallback (leaf-aware, case-insensitive). Results gain a per-message `folder` field plus `foldersSearched`, and any folder that fails to open is reported in `foldersErrored` rather than silently swallowed (a 0-result answer is never ambiguous). Default single-folder behavior is unchanged. Helper extracted to `src/utils/search-folders.ts`; tests in `tests/search-folders.test.ts` and `tests/email-tools-search-all.test.ts`.

### Changed
- Dependency updates (applied directly; Dependabot couldn't rebase its PRs due to a resolver issue with vitest 4's wasm bindings): `zod` 3 → 4, `typescript` 5 → 6, `commander` 14 → 15, `open` 10 → 11, `ora` 8 → 9, `@types/node` 24 → 26. TypeScript 6 needed `ignoreDeprecations: "6.0"` for the `node` module-resolution mode. `pdf-parse` was intentionally **not** upgraded to 2.x (breaking ESM rewrite that removes the `pdf-parse/lib/pdf-parse.js` entry point this server uses).

### Fixed
- CI `lint` job (`tsc --noEmit`) no longer OOM-kills. The root cause was the deep `registerTool` + zod-3 generic instantiation (`TS2589`); upgrading to **zod 4** (flatter types) makes the type-check finish in <1s instead of OOM-ing. As a result the interim heap workaround and all 9 `@ts-expect-error TS2589` suppressions were removed, and main's CI is green again.

## [1.4.0] - 2026-06-27

### Added
- Selective tool access via environment variables (Issue #87). `IMAP_MCP_READ_ONLY` (truthy: `1`/`true`/`yes`/`on`) registers only the safe, read-only subset — searching, reading, listing folders, unread counts, and spam analysis — and exposes no tool that sends mail, deletes/moves messages, changes flags, or edits accounts. `IMAP_MCP_ENABLED_TOOLS` is a comma-separated allowlist (case-insensitive, `imap_` prefix optional) that takes precedence over `IMAP_MCP_READ_ONLY`. With neither set, all tools are registered (unchanged default). Unknown tool names are ignored with a warning on stderr. Gating is applied in `src/tools/index.ts` via a server wrapper, so individual tool files are untouched. Tests: `tests/tool-access.test.ts`.

## [1.3.0] - 2026-06-17

### Added
- `imap_find_email_by_message_id` tool — resolve a stable RFC822 Message-ID to its current `{folder, uid}` across folders, robust to the message having been moved/archived (IMAP UIDs are folder-relative). Gmail `\All` fast path; generic INBOX → `\Archive` → `\Sent` → remaining folders. Exact-match verification against `envelope.messageId` rejects HEADER substring false-positives. Returns basic envelope + `foldersSearched` diagnostic.
- `messageId` search criterion on `imap_search_emails` (maps to IMAP `HEADER MESSAGE-ID`, substring-matched).
- `imap_get_email` options to control body and text-attachment output (`maxContentLength`, `includeAttachmentText`, `maxAttachmentTextChars`).
- Text attachment preview fields in email payloads (`attachments[].textContent`, `attachments[].textContentTruncated`).
- `imap_get_email` `bodyFormat` parameter (`markdown` default, `text`, `html`, `auto`) and a `markdownContent` body field. The body is converted to clean Markdown server-side (Turndown + the GFM strikethrough plugin), with email-specific rules: layout tables flattened, hidden/preheader nodes stripped, `<img>` reduced to its alt text, tracking URLs shortened.

### Changed
- `imap_get_email` now reports body truncation via `contentTruncated`.
- `imap_get_email` returns the body as Markdown by default and omits raw `htmlContent` unless `bodyFormat: "html"` is requested, so large HTML emails (a single marketing mail can be ~119k characters of markup) no longer cross the MCP boundary. `textContent` is still included for backward compatibility.
- Text extraction only runs for text-like attachments and enforces size limits to avoid binary bloat.

### Fixed
- Reconnect after an idle connection drop no longer fails with `Can not re-use ImapFlow instance`. ImapFlow instances are single-use, so `ImapService.ensureConnected` now tears down the dead client and constructs a fresh `ImapFlow` (via `connect()`) instead of calling `.connect()` on the stale object. This affected every multi-step IMAP workflow where the socket idled out between two tool calls (e.g. an `imap_connect` followed minutes later by an `imap_move_email`). Regression test: `tests/imap-service-reconnect.test.ts`.

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

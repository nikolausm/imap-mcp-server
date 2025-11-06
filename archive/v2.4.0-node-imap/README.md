# Archived Code - node-imap Implementation

This directory contains the deprecated IMAP service implementation using the `node-imap` library.

## Deprecation Information

- **Deprecated:** 2025-11-05
- **Version:** 2.4.0
- **Reason:** Migration to ImapFlow (Issue #27)
- **Replaced by:** ImapFlow implementation in v2.5.0

## Why This Code Was Archived

The `node-imap` library:
- Last updated in 2019 (unmaintained)
- Had 3 HIGH severity npm vulnerabilities
- Used callback-based API (outdated pattern)
- Required ~200 lines of manual keepalive logic

The new ImapFlow implementation:
- Actively maintained with regular updates
- Zero security vulnerabilities
- Native TypeScript with async/await API
- Built-in connection pooling and keepalive
- Better RFC compliance

## Files

- `imap-service.ts` - Original IMAP service implementation using node-imap

## Migration Details

See:
- Issue #27: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/27
- Release v2.5.0: https://github.com/Temple-of-Epiphany/imap-mcp-pro/releases/tag/v2.5.0
- CHANGELOG.md for full migration details

## Do Not Use

This code is archived for historical reference only. Do not use this code in production.
All functionality has been preserved and improved in the ImapFlow implementation.

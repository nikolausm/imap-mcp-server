# Changelog

All notable changes to IMAP MCP Pro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-05

### Major Release - IMAP MCP Pro

This major release transforms the project into an enterprise-grade commercial product with extensive reliability and monitoring features.

#### 🏢 Commercial Release
- **Rebranded** as IMAP MCP Pro
- **Transferred** to Temple of Epiphany organization
- **Dual-License Model** implemented:
  - FREE for non-commercial use (personal, educational, non-profit)
  - PAID commercial license for business use
- **Contact**: colin@bitterfield.com for commercial licensing

#### ⚡ Level 1: Enhanced Connectivity
- **Enhanced Keepalive**: RFC 2177 compliant NOOP commands every 29 minutes
- **Connection Monitoring**: Real-time connection health tracking
- **Connection Validation**: Proactive connection state verification
- **Error Handlers**: Improved error detection and handling

#### 🔄 Level 2: Advanced Reliability
- **Automatic Reconnection**: Exponential backoff strategy (1s → 2s → 4s → 8s → 60s max)
- **Retry Logic**: Transparent retry wrapper for all operations (max 5 attempts, configurable)
- **Health Checks**: Periodic NOOP every 29 minutes to prevent RFC 9051 timeout
- **Connection State Machine**: Complete state tracking (DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → ERROR)
- **Bulk Operations**:
  - `imap_bulk_delete_emails` - Delete hundreds/thousands of emails efficiently
  - `imap_bulk_get_emails` - Fetch multiple emails (headers/body/full modes)
  - `imap_bulk_mark_emails` - Mark emails as read/unread/flagged/unflagged

#### 🛡️ Level 3: Production-Grade Resilience
- **Circuit Breaker Pattern**: Prevents cascading failures
  - Opens after 5 failures (configurable)
  - HALF_OPEN state for recovery testing
  - Closes after 2 successes (configurable)
  - Rolling window failure tracking (2-minute default)
- **Operation Queue**: Queues operations during outages
  - 1000 operation max (configurable)
  - Priority queue support
  - Automatic replay when connection restored
  - 3 retries per operation (configurable)
- **Comprehensive Metrics**: Production monitoring
  - Per-connection metrics (operations, success rate, latency, uptime %)
  - Per-operation metrics (count, avg/min/max latency, success rate)
  - MCP tools: `imap_get_metrics`, `imap_get_operation_metrics`, `imap_reset_metrics`
- **Graceful Degradation**: Service resilience
  - Read-only mode when writes fail
  - Result caching (5-minute TTL, configurable)
  - Fallback to last known good data
  - Max degradation time (1 hour default)

#### 🧪 Testing & Validation
- **Test Script**: `test-tools.js` for verifying all 23 MCP tools
- **Tool Categories**: Account, Email, Bulk, Sending, Folder, Metrics
- **Automated Verification**: Exit codes for CI/CD integration

#### 📚 Documentation
- **Launchctl Setup Guide**: Complete macOS service integration (`docs/launchctl-setup.md`)
- **Level 1 Documentation**: Enhanced keepalive details (`docs/timeout-fixes-level1.md`)
- **Example Configurations**: Sample plist file for launchd
- **README Updates**: Comprehensive enterprise feature documentation

#### 🏗️ Architecture Improvements
- **TypeScript Types**: Complete type definitions for all Level 1-3 features
- **Code Organization**: 1126 lines of production-grade ImapService
- **Error Handling**: Enhanced error detection and recovery
- **Logging**: Stderr-based logging (stdout reserved for MCP protocol)

### Changed
- **Package Name**: `@temple-of-epiphany/imap-mcp-pro`
- **Repository**: `https://github.com/Temple-of-Epiphany/imap-mcp-pro`
- **Version**: Bumped to 2.0.0 for major release
- **License**: Changed from MIT to Dual-License model

### Added - MCP Tools
- `imap_bulk_delete_emails` - Bulk email deletion
- `imap_bulk_get_emails` - Bulk email fetching
- `imap_bulk_mark_emails` - Bulk email marking
- `imap_get_metrics` - Connection health metrics
- `imap_get_operation_metrics` - Operation statistics
- `imap_reset_metrics` - Reset metric tracking

Total Tools: **23** (up from 17)

### Technical Details

#### Configuration Options
All new features are configurable per account:

```json
{
  "keepalive": {
    "interval": 10000,
    "idleInterval": 1740000,
    "forceNoop": true
  },
  "retry": {
    "maxAttempts": 5,
    "initialDelay": 1000,
    "maxDelay": 60000,
    "backoffMultiplier": 2
  },
  "circuitBreaker": {
    "failureThreshold": 5,
    "successThreshold": 2,
    "timeout": 60000,
    "monitoringWindow": 120000
  },
  "operationQueue": {
    "maxSize": 1000,
    "maxRetries": 3,
    "processingInterval": 5000,
    "enablePriority": true
  },
  "degradation": {
    "enableReadOnlyMode": true,
    "enableCaching": true,
    "cacheTimeout": 300000,
    "fallbackToLastKnown": true,
    "maxDegradationTime": 3600000
  }
}
```

#### Pull Requests
- [#6](https://github.com/nikolausm/imap-mcp-server/pull/6) - Bulk delete operations
- [#7](https://github.com/nikolausm/imap-mcp-server/pull/7) - Launchctl documentation
- [#8](https://github.com/nikolausm/imap-mcp-server/pull/8) - Level 1 timeout fixes
- [#9](https://github.com/nikolausm/imap-mcp-server/pull/9) - Level 2 comprehensive features
- [#10](https://github.com/nikolausm/imap-mcp-server/pull/10) - Complete suite (submitted to upstream)
- [#11](https://github.com/nikolausm/imap-mcp-server/pull/11) - Test script (submitted to upstream)

### Attribution
Based on the original IMAP MCP Server by Michael Nikolaus (MIT License).
Extensive enterprise enhancements by Temple of Epiphany.

---

## [1.0.0] - 2024-12-XX (Original)

### Original Features (MIT Licensed Base)
- Basic IMAP connection management
- Account management with encrypted storage
- Email operations (search, read, mark, delete)
- SMTP email sending
- Folder management
- Web-based setup wizard
- 15+ email provider presets
- MCP integration with Claude Desktop

**Original Author**: Michael Nikolaus
**Original Repository**: https://github.com/nikolausm/imap-mcp-server
**Original License**: MIT License

---

## Upcoming Features

See [Issues](https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues) for planned features:

- **#1**: Unified bulk operations architecture
- **#2**: Web UI connection testing
- **#3**: SPAM detection API integration

---

## License

This project uses a **Dual-License Model**:
- **Non-Commercial**: FREE for personal, educational, and non-profit use
- **Commercial**: PAID license required for business use

See [LICENSE](LICENSE) for complete terms.

**Contact**: colin@bitterfield.com

---

**Note**: This CHANGELOG starts at version 2.0.0 (IMAP MCP Pro). For history prior to the fork and commercial release, see the [original repository](https://github.com/nikolausm/imap-mcp-server).

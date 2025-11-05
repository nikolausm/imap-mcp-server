# Changelog

All notable changes to IMAP MCP Pro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2025-11-05

### Service Discovery & Folder Management (Issues #16, #19)

This release adds self-documenting capabilities and complete folder lifecycle management.

#### ✨ New Features

**Service Discovery & Meta Tools (Issue #16)**
- **imap_about Tool**: Returns comprehensive service metadata
  - Service name, description, and version
  - License model (Dual-License)
  - Repository URLs and documentation links
  - Feature highlights (Level 1-3 reliability, bulk operations, etc.)
  - Total tool count and categorization
  - Attribution and contributor information
- **imap_list_tools Tool**: Returns detailed manifest of all available tools
  - Lists all 32 MCP tools with descriptions
  - Filterable by category (account, email, bulk, folder, sending, metrics, meta)
  - Shows parameters for each tool
  - Categorized by function for easy discovery

**Folder Management Operations (Issue #19)**
- **imap_create_folder Tool**: Create new folders/mailboxes
  - Supports hierarchy using "/" delimiter (e.g., "Archive/2024")
  - Full error handling for invalid folder names
- **imap_delete_folder Tool**: Delete existing folders/mailboxes
  - Removes folders completely from IMAP server
  - Validates folder exists before deletion
- **imap_rename_folder Tool**: Rename folders/mailboxes
  - Maintains folder hierarchy
  - Updates all folder references atomically

#### 🎯 Enhanced Claude Integration

**Claude can now answer questions like:**
- "Tell me about the IMAP MCP service"
- "What version is the IMAP MCP service?"
- "What functions are available in IMAP MCP?"
- "Show me all bulk operation tools"
- "List email sending tools"

**Claude can now manage folders:**
- "Create a new folder called Projects"
- "Rename the Old folder to Archive"
- "Delete the Spam folder"

#### 🛠️ Technical Improvements
- New file: `src/tools/meta-tools.ts` for service discovery
- Added folder management methods to `ImapService`:
  - `createFolder(accountId, folderName)`
  - `deleteFolder(accountId, folderName)`
  - `renameFolder(accountId, oldName, newName)`
- Updated MCP server name from 'imap-mcp-server' to 'imap-mcp-pro'
- Updated test-tools.js to verify 32 total tools (up from 27)
- All operations use retry wrapper and circuit breaker pattern

#### 📊 Tool Count
- **Total Tools**: 32 (up from 27)
- **New Tools**: 5
  - `imap_about` - Service information and metadata
  - `imap_list_tools` - Tool discovery and listing
  - `imap_create_folder` - Create new folders
  - `imap_delete_folder` - Delete folders
  - `imap_rename_folder` - Rename folders

#### 📝 Files Modified
- `src/tools/meta-tools.ts` - NEW: Meta/discovery tools
- `src/tools/folder-tools.ts` - Added 3 new folder management tools
- `src/services/imap-service.ts` - Added folder management methods
- `src/tools/index.ts` - Registered meta tools
- `src/index.ts` - Updated server name and version
- `package.json` - Version bump to 2.4.0
- `test-tools.js` - Updated to test 32 tools
- `CHANGELOG.md` - This file

#### 🎉 Benefits
- **Self-Documenting**: Service describes itself to Claude
- **Version Awareness**: Claude always knows current version
- **Discovery**: Users explore capabilities through conversation
- **Complete Folder Management**: Full lifecycle operations (create, delete, rename)
- **Organization**: Users can create custom folder structures
- **Cleanup**: Delete unused folders
- **Flexibility**: Rename folders as needs change

#### GitHub
- Closes Issue #16: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/16
- Closes Issue #19: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/19
- Addresses Issue #11: Version Query Tool (via imap_about)

---

## [2.2.0] - 2025-01-05

### Web UI Connection Testing (Issue #5)

This release significantly improves the user experience during account setup by adding comprehensive connection testing with detailed feedback.

#### ✨ New Features
- **Test Connection Button**: Now visible on all account forms (new and edit)
- **Detailed Success Information**: Shows folder count, connection time, server details, and TLS status
- **Smart Error Messages**: Context-aware error messages with actionable troubleshooting tips
- **Real-time Feedback**: Test connection without leaving the setup form

#### 🎯 Enhanced Connection Test Display

**Success Display Shows:**
- 📊 Number of folders found
- ⏱️ Connection time in milliseconds
- 🖥️ Server host and port
- 🔒 TLS enabled/disabled status

**Error Display Shows:**
- Clear error message
- Helpful troubleshooting tips based on error type:
  - **Authentication failures**: Suggests app-specific passwords
  - **Timeouts**: Recommends checking host/port/firewall
  - **Connection refused**: Suggests verifying server and IMAP settings
  - **SSL/TLS errors**: Recommends toggling TLS settings
  - **DNS errors**: Suggests checking hostname spelling

#### 🛠️ Technical Improvements
- Enhanced `/api/test-connection` endpoint with detailed response
- Connection time measurement
- Error categorization with regex matching
- Improved UI with better visual hierarchy

#### 🎨 UI Enhancements
- Test button always visible (previously only in edit mode)
- Redesigned success/error display with icons and structure
- Better spacing and readability
- Responsive layout for all screen sizes

#### 📝 Files Modified
- `src/web/server.ts` - Enhanced API endpoint with details and helpful errors
- `public/index.html` - Improved test result display UI
- `public/js/app.js` - Updated frontend logic to show details
- `CHANGELOG.md` - This file

#### 🎉 Benefits
- **Better UX**: Immediate feedback on credential correctness
- **Faster Setup**: Test before saving reduces trial-and-error
- **Self-Service Troubleshooting**: Users can diagnose common issues independently
- **Reduced Support Burden**: Clear, actionable error messages

#### GitHub
- Closes Issue #5: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/5

---

## [2.1.0] - 2025-01-05

### Unified Bulk Operations Architecture (Issue #4)

This release implements a unified architecture where single operations call bulk operations internally, eliminating code duplication and establishing a consistent pattern.

#### ♻️ Refactored Operations
- **markAsRead**: Now calls `bulkMarkEmails([uid], 'read')` internally
- **markAsUnread**: Now calls `bulkMarkEmails([uid], 'unread')` internally
- **deleteEmail**: Now calls `bulkDeleteEmails([uid], true)` internally

#### ✨ New Copy/Move Operations
- **bulkCopyEmails**: Copy multiple emails to another folder efficiently
- **bulkMoveEmails**: Move multiple emails (copy + mark deleted) efficiently
- **copyEmail**: Single email copy wrapper (calls bulk internally)
- **moveEmail**: Single email move wrapper (calls bulk internally)

#### 🛠️ New MCP Tools (4)
- `imap_copy_email` - Copy single email to another folder
- `imap_bulk_copy_emails` - Copy multiple emails to another folder
- `imap_move_email` - Move single email to another folder
- `imap_bulk_move_emails` - Move multiple emails to another folder

Total Tools: **27** (up from 23)

#### 🎯 Benefits
- **Less Code Duplication**: ~30 lines removed from single operations
- **Consistent Behavior**: All operations use same retry/circuit breaker logic
- **Easier Maintenance**: Changes in one place affect both single and bulk operations
- **New Functionality**: Copy/move operations for better email management
- **MSP-Ready**: Architecture supports multi-tenant account hierarchies

#### 🧪 Testing
- Added `test-tools.js` script to verify all 27 tools register correctly
- Build passes without TypeScript errors
- All tools tested and verified

#### 📝 Files Modified
- `src/services/imap-service.ts` - Refactored operations + new copy/move methods
- `src/tools/email-tools.ts` - Added 4 new MCP tools
- `test-tools.js` - New test script (27 tools expected)
- `README.md` - Updated tool documentation
- `CHANGELOG.md` - This file

#### GitHub
- Closes Issue #4: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/4

---

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

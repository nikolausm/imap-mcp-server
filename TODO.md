# IMAP MCP Pro - Development TODO

**Project**: IMAP MCP Pro (Enterprise Edition)
**Organization**: Temple of Epiphany
**Repository**: https://github.com/Temple-of-Epiphany/imap-mcp-pro
**Contact**: colin.bitterfield@templeofepiphany.com
**Date**: 2025-01-05

---

## 🎯 Current Status

### ✅ Completed
- [x] Repository transferred to Temple-of-Epiphany organization
- [x] Renamed to imap-mcp-pro
- [x] Dual-license model implemented (Non-Commercial FREE / Commercial PAID)
- [x] LICENSE file updated with comprehensive terms
- [x] README updated with enterprise features and branding
- [x] package.json updated with new metadata
- [x] All Level 1-3 reliability features implemented and tested
- [x] Bulk operations (delete, get, mark) implemented
- [x] Metrics and monitoring tools implemented
- [x] Test script created for verification
- [x] CHANGELOG.md created
- [x] All changes committed and pushed to main

### 🔄 In Progress
None - ready for next tasks

### 📋 Upcoming Tasks (Prioritized)

---

## Priority 1: Core Refactoring

### Issue #4: Unified Bulk Operations Architecture
**Status**: Not Started
**GitHub**: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/4
**Priority**: High
**Estimated Time**: 4-6 hours

#### Objective
Refactor single operations to call bulk operations internally, eliminating code duplication.

#### Tasks
- [ ] **Step 1**: Analyze current implementation
  - Review `markAsRead`, `markAsUnread`, `deleteEmail` in `src/services/imap-service.ts`
  - Review `bulkMarkEmails`, `bulkDeleteEmails` implementations
  - Document current pattern and duplication

- [ ] **Step 2**: Refactor marking operations
  ```typescript
  // Convert these to wrappers:
  async markAsRead(accountId, folder, uid) {
    return this.bulkMarkEmails(accountId, folder, [uid], 'read');
  }

  async markAsUnread(accountId, folder, uid) {
    return this.bulkMarkEmails(accountId, folder, [uid], 'unread');
  }
  ```
  - Update `markAsRead` in `src/services/imap-service.ts:651`
  - Update `markAsUnread` in `src/services/imap-service.ts:665`
  - Ensure metrics still track correctly
  - Verify circuit breaker applies

- [ ] **Step 3**: Refactor delete operation
  ```typescript
  async deleteEmail(accountId, folder, uid) {
    return this.bulkDeleteEmails(accountId, folder, [uid], false);
  }
  ```
  - Update `deleteEmail` in `src/services/imap-service.ts:679`
  - Preserve expunge parameter behavior
  - Test single email deletion still works

- [ ] **Step 4**: Add copy/move operations
  - Implement `bulkCopyEmails(accountId, sourceFolder, uids, targetFolder)`
  - Implement `bulkMoveEmails(accountId, sourceFolder, uids, targetFolder)`
  - Add single operation wrappers: `copyEmail`, `moveEmail`
  - Add MCP tools in `src/tools/email-tools.ts`:
    - `imap_copy_email`
    - `imap_bulk_copy_emails`
    - `imap_move_email`
    - `imap_bulk_move_emails`

- [ ] **Step 5**: Update types
  - Add types to `src/types/index.ts` if needed
  - Update tool schemas with Zod validation
  - Build and verify TypeScript compilation

- [ ] **Step 6**: Test thoroughly
  - Run `node test-tools.js` - should show 27 tools total (23 + 4 new)
  - Test single operations work correctly
  - Test bulk operations work correctly
  - Verify metrics track all operations
  - Test circuit breaker applies to all operations

- [ ] **Step 7**: Documentation
  - Update README with new copy/move tools
  - Update CHANGELOG.md
  - Add code comments for new operations

- [ ] **Step 8**: Commit and deploy
  - Create branch: `feature/unified-bulk-operations`
  - Commit changes with descriptive message
  - Push to origin
  - Close Issue #4

**Files to Modify**:
- `src/services/imap-service.ts` (main implementation)
- `src/tools/email-tools.ts` (MCP tool definitions)
- `src/types/index.ts` (type definitions if needed)
- `test-tools.js` (update expected tool count to 27)
- `README.md` (documentation)
- `CHANGELOG.md` (version history)

---

## Priority 2: Web UI Enhancements

### Issue #5: Web UI Connection Testing
**Status**: Not Started
**GitHub**: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/5
**Priority**: High
**Estimated Time**: 3-4 hours

#### Objective
Add connection testing functionality to the web UI for better UX.

#### Tasks
- [ ] **Step 1**: Backend API
  - Add `/api/test-connection` endpoint in `src/web/server.ts`
  - Accept `{host, port, user, password, tls}` in request body
  - Use existing `ImapService.connect()` with timeout
  - Return `{success, message, details: {serverCapabilities, folderCount, connectionTime}, error}`
  - Add error handling with helpful messages

- [ ] **Step 2**: Frontend UI
  - Locate account form in web UI files
  - Add "Test Connection" button next to Save button
  - Add loading spinner component
  - Add results display area (success/error styles)
  - Handle button states (disabled during test)

- [ ] **Step 3**: Frontend Logic
  - Create `testConnection()` function
  - Make POST request to `/api/test-connection`
  - Display results with appropriate styling:
    - ✅ Success: Green, show connection details
    - ❌ Error: Red, show error message and helpful tips
  - Handle network errors gracefully

- [ ] **Step 4**: Error Messages
  - Add helpful error messages for common issues:
    - Authentication failed → "Check password or use app password"
    - Timeout → "Check host and port settings"
    - Connection refused → "Verify server address and firewall"
    - SSL/TLS errors → "Try toggling TLS setting"

- [ ] **Step 5**: Testing
  - Test with valid credentials (should succeed)
  - Test with invalid password (should show auth error)
  - Test with wrong host (should show connection error)
  - Test with wrong port (should timeout gracefully)
  - Test loading states and button disable/enable

- [ ] **Step 6**: Documentation
  - Update README with new feature
  - Add screenshots if possible
  - Update CHANGELOG.md

- [ ] **Step 7**: Commit and deploy
  - Create branch: `feature/web-ui-connection-test`
  - Commit changes
  - Push to origin
  - Close Issue #5

**Files to Modify**:
- `src/web/server.ts` (backend API)
- Web UI frontend files (locate in `src/web/` directory)
- `README.md` (documentation)
- `CHANGELOG.md` (version history)

---

## Priority 3: New Features

### Issue #3: SPAM Detection API Integration
**Status**: Not Started
**GitHub**: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/3
**Priority**: Medium-High
**Estimated Time**: 8-10 hours

#### Objective
Add SPAM detection as a bulk operation with API integration support.

#### Tasks
- [ ] **Step 1**: Research and design
  - Research SpamAssassin API
  - Research Akismet API
  - Design `SpamDetectionService` class
  - Design cache strategy for spam scores
  - Design configuration schema

- [ ] **Step 2**: Create SpamDetectionService
  - Create `src/services/spam-detection-service.ts`
  - Implement provider interface
  - Implement SpamAssassin provider
  - Implement Akismet provider
  - Implement caching layer
  - Add configuration support

- [ ] **Step 3**: Integrate with ImapService
  - Add spam detection methods to ImapService
  - `analyzeSpam(accountId, folder, uids)` → returns spam scores
  - Use bulk email fetch for efficiency
  - Cache results by messageId

- [ ] **Step 4**: Add MCP tools
  - `imap_analyze_spam` - Analyze emails for spam
  - `imap_bulk_move_spam` - Move spam to spam folder
  - Add to `src/tools/email-tools.ts`

- [ ] **Step 5**: Configuration
  - Add spam config to ImapAccount type
  - Update account setup wizard
  - Add spam settings to web UI

- [ ] **Step 6**: Testing
  - Unit tests for SpamDetectionService
  - Integration tests with test SPAM emails
  - Test bulk operations
  - Test caching
  - Test API key security

- [ ] **Step 7**: Documentation
  - Document spam detection features
  - Document API setup instructions
  - Add configuration examples
  - Update README and CHANGELOG

- [ ] **Step 8**: Commit and deploy
  - Create branch: `feature/spam-detection`
  - Commit changes
  - Push to origin
  - Close Issue #3

**New Files**:
- `src/services/spam-detection-service.ts`
- `src/types/spam-types.ts` (if needed)

**Files to Modify**:
- `src/services/imap-service.ts`
- `src/tools/email-tools.ts`
- `src/types/index.ts`
- `README.md`
- `CHANGELOG.md`

---

## Additional Tasks

### Documentation
- [ ] Create `CONTRIBUTING.md` guide
- [ ] Create `SECURITY.md` policy
- [ ] Add API documentation (JSDoc comments)
- [ ] Create developer setup guide
- [ ] Add architecture diagrams

### Testing
- [ ] Set up Jest or similar test framework
- [ ] Add unit tests for core functions
- [ ] Add integration tests for IMAP operations
- [ ] Add end-to-end tests for MCP tools
- [ ] Set up CI/CD pipeline (GitHub Actions)

### Commercial Features
- [ ] Create commercial license purchase page
- [ ] Add license key validation system
- [ ] Create customer portal
- [ ] Set up support ticket system
- [ ] Add usage analytics (opt-in)

### Performance
- [ ] Profile bulk operations for bottlenecks
- [ ] Optimize connection pooling
- [ ] Add connection pool size limits
- [ ] Implement lazy loading for large email lists
- [ ] Add pagination for search results

### Security
- [ ] Security audit of credential storage
- [ ] Add rate limiting
- [ ] Add IP allowlist/denylist
- [ ] Implement 2FA for web UI
- [ ] Add audit logging

---

## Git Workflow

### Current Branch: `main`
- All Level 1-3 features merged
- Dual-license model implemented
- Ready for new feature branches

### Creating Feature Branches
```bash
# Checkout main and pull latest
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes...

# Commit and push
git add -A
git commit -m "Descriptive commit message"
git push origin feature/your-feature-name

# Create PR on GitHub
gh pr create --repo Temple-of-Epiphany/imap-mcp-pro \
  --base main \
  --title "Your Feature Title" \
  --body "Feature description"
```

### Branch Naming Convention
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/updates

---

## Quick Commands

### Build and Test
```bash
# Build TypeScript
npm run build

# Test all tools
node test-tools.js

# Start web UI
npm run web

# Start MCP server (development)
npm run dev
```

### Repository Management
```bash
# Check remotes
git remote -v

# Create issue
gh issue create --repo Temple-of-Epiphany/imap-mcp-pro

# List issues
gh issue list --repo Temple-of-Epiphany/imap-mcp-pro

# Create PR
gh pr create --repo Temple-of-Epiphany/imap-mcp-pro
```

---

## Issues Tracker

### Open Issues (Temple-of-Epiphany/imap-mcp-pro)
- **#3**: SPAM detection API integration (https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/3)
- **#4**: Unified bulk operations architecture (https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/4)
- **#5**: Web UI connection testing (https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues/5)

---

## Contact & Support

**Organization**: Temple of Epiphany
**Maintainer**: Colin Bitterfield
**Email**: colin.bitterfield@templeofepiphany.com
**Repository**: https://github.com/Temple-of-Epiphany/imap-mcp-pro

---

## Notes

### Recent Major Changes (2025-01-05)
1. Transferred from personal fork to Temple-of-Epiphany organization
2. Renamed from imap-mcp-server to imap-mcp-pro
3. Changed license from MIT to Dual-License model
4. Bumped version to 2.0.0 for commercial release
5. Added comprehensive CHANGELOG.md

### License Requirements
- **Non-Commercial Use**: FREE (personal, educational, non-profit)
- **Commercial Use**: PAID license required
- Contact colin.bitterfield@templeofepiphany.com for commercial licensing

### Next Session Resume Point
Start with **Priority 1: Issue #4 - Unified Bulk Operations**. This is the most impactful change and sets the foundation for adding copy/move operations.

---

**Last Updated**: 2025-01-05
**Status**: Ready for next development session

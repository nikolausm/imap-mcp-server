# IMAP MCP Pro - Technical Specification

**Project**: IMAP MCP Pro (Enterprise Edition)
**Organization**: Temple of Epiphany
**Repository**: https://github.com/Temple-of-Epiphany/imap-mcp-pro
**Contact**: colin.bitterfield@templeofepiphany.com
**Version**: 2.12.0
**Date Created**: 2025-01-24
**Date Updated**: 2025-01-27
**Specification Version**: 1.0.0

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [MCP Tools](#mcp-tools)
4. [Core Services](#core-services)
5. [Email Provider Presets](#email-provider-presets)
6. [Reliability Features](#reliability-features)
7. [Security](#security)
8. [Database Schema](#database-schema)
9. [Configuration](#configuration)
10. [API Endpoints](#api-endpoints)
11. [Testing](#testing)
12. [Deployment](#deployment)

---

## Overview

### Purpose
IMAP MCP Pro is a Model Context Protocol (MCP) server that provides comprehensive IMAP email integration for Claude AI, enabling intelligent email management, automation, and analysis.

### Key Features
- ✅ **45 MCP Tools** for complete email management
- ✅ **15 Email Provider Presets** (Gmail, Outlook, Yahoo, etc.)
- ✅ **Auto-Chunking** for operations >50 UIDs
- ✅ **Circuit Breaker Pattern** with automatic recovery
- ✅ **Connection Pooling** and reconnection logic
- ✅ **Multi-User Support** via MCP_USER_ID isolation
- ✅ **SMTP Support** for sending/replying/forwarding
- ✅ **RFC 9051 Compliance** (IMAP4rev2)
- ✅ **Web UI** for account management
- ✅ **Encrypted Credentials** (AES-256-GCM)

### Technology Stack
- **Runtime**: Node.js v18+
- **Language**: TypeScript 5.x
- **IMAP Library**: ImapFlow
- **SMTP Library**: Nodemailer
- **Database**: SQLite3 (better-sqlite3)
- **MCP SDK**: @modelcontextprotocol/sdk v1.0+
- **Encryption**: crypto (AES-256-GCM)

---

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────┐
│                     Claude Desktop                       │
│                   (MCP Client)                          │
└─────────────────────────────────────────────────────────┘
                        │
                        │ MCP Protocol (stdio)
                        │
┌─────────────────────────────────────────────────────────┐
│                  IMAP MCP Pro Server                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │              MCP Tool Handlers                    │  │
│  │  - Account Management (8 tools)                  │  │
│  │  - Email Operations (12 tools)                   │  │
│  │  - Bulk Operations (9 tools)                     │  │
│  │  - Folder Management (6 tools)                   │  │
│  │  - RFC 9051 Features (7 tools)                   │  │
│  │  - Meta Tools (2 tools)                          │  │
│  │  - Provider Presets (3 tools)                    │  │
│  └───────────────────────────────────────────────────┘  │
│                        │                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Core Services Layer                  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ImapService  │ │SmtpService   │ │DatabaseSvc │ │  │
│  │  │             │ │              │ │            │ │  │
│  │  │- Connection │ │- Send Email  │ │- User Auth │ │  │
│  │  │- Pooling    │ │- Reply/Fwd   │ │- Accounts  │ │  │
│  │  │- Retry      │ │- Templates   │ │- Encryption│ │  │
│  │  │- Circuit    │ │- SMTP Config │ │- Metadata  │ │  │
│  │  │  Breaker    │ │              │ │            │ │  │
│  │  └─────────────┘ └──────────────┘ └────────────┘ │  │
│  └───────────────────────────────────────────────────┘  │
│                        │                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │            External Integrations                  │  │
│  │  ┌──────────────┐  ┌──────────────┐              │  │
│  │  │IMAP Servers  │  │SMTP Servers  │              │  │
│  │  │- ImapFlow    │  │- Nodemailer  │              │  │
│  │  └──────────────┘  └──────────────┘              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
                        │
        ┌───────────────┴────────────────┐
        │                                │
   ┌────▼─────┐                   ┌─────▼────┐
   │SQLite DB │                   │Web UI    │
   │(Encrypted│                   │(Port 3000│
   │Accounts) │                   │/Optional)│
   └──────────┘                   └──────────┘
```

### Directory Structure
```
imap-mcp-pro/
├── src/
│   ├── index.ts                    # MCP Server entry point
│   ├── services/
│   │   ├── imap-service.ts         # IMAP operations & connection pooling
│   │   ├── smtp-service.ts         # SMTP email sending
│   │   ├── database-service.ts     # User/account management
│   │   ├── account-manager.ts      # DEPRECATED (use DatabaseService)
│   │   └── ...scoring/firewall     # Optional integrations
│   ├── tools/
│   │   ├── account-tools.ts        # Account management MCP tools
│   │   ├── email-tools.ts          # Email operation MCP tools
│   │   ├── folder-tools.ts         # Folder management MCP tools
│   │   ├── meta-tools.ts           # Discovery & about tools
│   │   └── ...                     # Additional tool categories
│   ├── providers/
│   │   └── email-providers.ts      # 15 provider presets
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/
│   │   ├── error-handler.ts        # Error handling utilities
│   │   └── memory-manager.ts       # LRU cache for metrics
│   ├── database/
│   │   ├── schema.sql              # SQLite schema
│   │   └── schema_update_*.sql     # Migration scripts
│   └── web/
│       ├── server.ts               # Web UI backend
│       └── ...                     # Frontend assets
├── dist/                           # Compiled JavaScript (gitignored)
├── docs/                           # Documentation
│   ├── SPECIFICATION.md            # This file
│   ├── chunked_bulk_operations.md  # Auto-chunking guide
│   └── ...
├── public/                         # Web UI assets
├── test-tools.js                   # Tool registration tests
├── Makefile                        # Build/install/service management
└── package.json                    # Dependencies & scripts
```

---

## MCP Tools

### Complete Tool Catalog (45 Tools)

#### 1. Account Management (5 tools)

**imap_add_account**
- **Purpose**: Add IMAP account with manual IMAP/SMTP settings
- **Inputs**: name, host, port, user, password, tls
- **Outputs**: accountId, success message
- **Notes**: For custom/unsupported providers

**imap_list_accounts**
- **Purpose**: List all accounts for current user
- **Inputs**: None (uses MCP_USER_ID from env)
- **Outputs**: Array of account metadata (id, name, host, port, user, tls)
- **Notes**: Passwords not returned for security

**imap_remove_account**
- **Purpose**: Delete account from database
- **Inputs**: accountId
- **Outputs**: Success confirmation
- **Notes**: Auto-disconnects before deletion

**imap_connect**
- **Purpose**: Establish IMAP connection to account
- **Inputs**: accountId
- **Outputs**: Connection status, account name
- **Notes**: Uses connection pooling, auto-reconnect on failure

**imap_disconnect**
- **Purpose**: Close IMAP connection
- **Inputs**: accountId
- **Outputs**: Success confirmation
- **Notes**: Graceful logout, cleans up resources

#### 2. Email Provider Presets (3 tools)

**imap_list_providers**
- **Purpose**: List all 15 pre-configured email provider presets
- **Inputs**: None
- **Outputs**: Array of providers with IMAP/SMTP settings, help URLs, app password requirements
- **Providers**:
  - gmail, outlook, yahoo, icloud, aol
  - gmx, webde, ionos, mailbox, posteo
  - office365, zoho, protonmail, fastmail, hostinger, custom

**imap_add_account_with_provider**
- **Purpose**: Add account using provider ID
- **Inputs**: providerId, name, email, password, smtpEnabled
- **Outputs**: accountId, provider name, IMAP/SMTP settings used, warnings
- **Notes**: Auto-fills settings, warns about app passwords

**imap_add_account_auto**
- **Purpose**: Add account with auto-detected provider from email domain
- **Inputs**: name, email, password, smtpEnabled
- **Outputs**: accountId, detected provider, settings
- **Notes**: Detects provider from @domain (e.g., @gmail.com → Gmail preset)

#### 3. Email Operations (9 tools)

**imap_search_emails**
- **Purpose**: Search emails with criteria
- **Inputs**: accountId, folder, from, to, subject, body, since, before, seen, flagged, limit
- **Outputs**: Array of email metadata (uid, flags, from, to, subject, date)
- **Notes**: Returns headers only, use imap_get_email for content

**imap_get_email**
- **Purpose**: Fetch full email content
- **Inputs**: accountId, folder, uid, headersOnly
- **Outputs**: Full email (headers + body/html + attachments)
- **Notes**: headersOnly=true for bandwidth savings

**imap_mark_as_read / imap_mark_as_unread**
- **Purpose**: Mark single email read/unread
- **Inputs**: accountId, folder, uid
- **Outputs**: Success confirmation
- **Notes**: Wrapper around bulk operations

**imap_delete_email**
- **Purpose**: Delete single email
- **Inputs**: accountId, folder, uid
- **Outputs**: Success confirmation
- **Notes**: Marks as deleted + expunges, wrapper around bulk

**imap_get_latest_emails**
- **Purpose**: Get N most recent emails
- **Inputs**: accountId, folder, count
- **Outputs**: Sorted array of latest emails
- **Notes**: Sorted by date descending

**imap_send_email**
- **Purpose**: Send new email via SMTP
- **Inputs**: accountId, to, subject, text, html, cc, bcc, replyTo, attachments
- **Outputs**: messageId, success
- **Notes**: Requires SMTP configured on account

**imap_reply_to_email**
- **Purpose**: Reply to existing email
- **Inputs**: accountId, folder, uid, text, html, replyAll, attachments
- **Outputs**: messageId, success
- **Notes**: Auto-sets In-Reply-To header

**imap_forward_email**
- **Purpose**: Forward email to recipients
- **Inputs**: accountId, folder, uid, to, text, includeAttachments
- **Outputs**: messageId, success
- **Notes**: Adds forward header with original metadata

#### 4. Bulk Operations (3 tools + AUTO-CHUNKING)

**imap_bulk_get_emails**
- **Purpose**: Fetch multiple emails at once
- **Inputs**: accountId, folder, uids[], fields (headers/body/full)
- **Outputs**: Array of email objects
- **Auto-Chunking**: >50 UIDs → chunks of 100
- **Notes**: Content truncated to 5000 chars per field

**imap_bulk_mark_emails**
- **Purpose**: Mark multiple emails with flags
- **Inputs**: accountId, folder, uids[], operation (read/unread/flagged/answered/draft/deleted)
- **Outputs**: Success count or detailed results if chunked
- **Auto-Chunking**: >50 UIDs → chunks of 100
- **Operations**: read, unread, flagged, unflagged, answered, unanswered, draft, not-draft, deleted, undeleted

**imap_bulk_delete_emails**
- **Purpose**: Delete multiple emails
- **Inputs**: accountId, folder, uids[], expunge
- **Outputs**: Deleted count or detailed results if chunked
- **Auto-Chunking**: >50 UIDs → chunks of 100
- **Notes**: expunge=false just marks as deleted

#### 5. Chunked Bulk Operations (3 tools - EXPLICIT CONTROL)

**imap_bulk_get_emails_chunked**
- **Purpose**: Explicit chunked fetch for large operations
- **Inputs**: accountId, folder, uids[], fields, chunkSize
- **Outputs**: Array of emails + progress info
- **Use Case**: When you need custom chunk size or progress tracking

**imap_bulk_mark_emails_chunked**
- **Purpose**: Explicit chunked marking for large operations
- **Inputs**: accountId, folder, uids[], operation, chunkSize
- **Outputs**: {processed, failed, errors[]}
- **Use Case**: Fine-grained control + error recovery

**imap_bulk_delete_emails_chunked**
- **Purpose**: Explicit chunked delete for large operations
- **Inputs**: accountId, folder, uids[], expunge, chunkSize
- **Outputs**: {processed, failed, errors[]}
- **Use Case**: Reliable large-scale deletion

#### 6. Copy/Move Operations (4 tools)

**imap_copy_email**
- **Purpose**: Copy single email to another folder
- **Inputs**: accountId, sourceFolder, uid, targetFolder
- **Outputs**: Success confirmation

**imap_bulk_copy_emails**
- **Purpose**: Copy multiple emails to another folder
- **Inputs**: accountId, sourceFolder, uids[], targetFolder
- **Outputs**: Success confirmation

**imap_move_email**
- **Purpose**: Move single email (copy + delete source)
- **Inputs**: accountId, sourceFolder, uid, targetFolder
- **Outputs**: Success confirmation

**imap_bulk_move_emails**
- **Purpose**: Move multiple emails (copy + delete source)
- **Inputs**: accountId, sourceFolder, uids[], targetFolder
- **Outputs**: Success confirmation

#### 7. Folder Operations (6 tools)

**imap_list_folders**
- **Purpose**: List all IMAP folders
- **Inputs**: accountId
- **Outputs**: Array of folders with attributes

**imap_folder_status**
- **Purpose**: Get folder metadata
- **Inputs**: accountId, folder
- **Outputs**: Message counts, uidvalidity, uidnext

**imap_get_unread_count**
- **Purpose**: Count unread emails in folders
- **Inputs**: accountId, folders[]
- **Outputs**: Unread counts per folder

**imap_create_folder**
- **Purpose**: Create new folder (RFC 9051 required)
- **Inputs**: accountId, folderName
- **Outputs**: Success confirmation

**imap_delete_folder**
- **Purpose**: Delete folder (RFC 9051 required)
- **Inputs**: accountId, folderName
- **Outputs**: Success confirmation

**imap_rename_folder**
- **Purpose**: Rename folder (RFC 9051 required)
- **Inputs**: accountId, oldName, newName
- **Outputs**: Success confirmation

#### 8. RFC 9051 Compliance (7 tools)

**imap_add_keyword**
- **Purpose**: Add custom keyword/flag to emails
- **Inputs**: accountId, folder, uids[], keyword
- **Outputs**: Success confirmation
- **Keywords**: $Forwarded, $MDNSent, $Junk, $NotJunk, $Phishing, or custom

**imap_remove_keyword**
- **Purpose**: Remove custom keyword from emails
- **Inputs**: accountId, folder, uids[], keyword
- **Outputs**: Success confirmation

**imap_append_message**
- **Purpose**: Upload raw RFC822 message to mailbox
- **Inputs**: accountId, mailbox, messageContent, flags, internalDate
- **Outputs**: {uid, uidValidity}
- **Use Cases**: Import emails, save drafts, restore backups

**imap_subscribe_mailbox**
- **Purpose**: Subscribe to mailbox (RFC 9051 SUBSCRIBE command)
- **Inputs**: accountId, mailboxName
- **Outputs**: Success confirmation

**imap_unsubscribe_mailbox**
- **Purpose**: Unsubscribe from mailbox (RFC 9051 UNSUBSCRIBE)
- **Inputs**: accountId, mailboxName
- **Outputs**: Success confirmation

**imap_list_subscribed_mailboxes**
- **Purpose**: List subscribed mailboxes only
- **Inputs**: accountId
- **Outputs**: Array of subscribed folders

**imap_get_mailbox_status**
- **Purpose**: Get mailbox status without selecting (RFC 9051 STATUS)
- **Inputs**: accountId, mailboxName
- **Outputs**: {messages, uidNext, uidValidity, unseen, deleted, size}
- **Extensions**: Supports STATUS=SIZE and STATUS=DELETED if server supports

#### 9. Metrics & Monitoring (3 tools)

**imap_get_metrics**
- **Purpose**: Get connection health metrics
- **Inputs**: accountId
- **Outputs**: {totalOperations, successfulOperations, failedOperations, averageLatency, uptime}

**imap_get_operation_metrics**
- **Purpose**: Get detailed per-operation metrics
- **Inputs**: accountId, operationName (optional)
- **Outputs**: Array of {operationName, count, successCount, failureCount, avgLatency, minLatency, maxLatency}

**imap_reset_metrics**
- **Purpose**: Reset all metrics for account
- **Inputs**: accountId
- **Outputs**: Success confirmation

#### 10. Meta/Discovery Tools (2 tools)

**imap_about**
- **Purpose**: Get server information
- **Outputs**: {name, version, author, organization, license, repository, capabilities}

**imap_list_tools**
- **Purpose**: List all available MCP tools by category
- **Outputs**: {totalTools, categories: {name, tools[], count}}

---

## Core Services

### ImapService (`src/services/imap-service.ts`)

**Responsibilities**:
- IMAP connection management with pooling
- Email search, fetch, mark, delete operations
- Folder management (list, create, delete, rename)
- Bulk operations with auto-chunking
- Circuit breaker pattern
- Automatic reconnection with exponential backoff
- Operation queue for failed operations
- Metrics collection

**Key Methods**:
```typescript
// Connection Management
connect(account: ImapAccount, isReconnect?: boolean): Promise<void>
disconnect(accountId: string): Promise<void>
reconnect(accountId: string): Promise<void>

// Email Operations
searchEmails(accountId, folder, criteria): Promise<EmailMessage[]>
getEmailContent(accountId, folder, uid, headersOnly?): Promise<EmailContent>
markAsRead/markAsUnread(accountId, folder, uid): Promise<void>
deleteEmail(accountId, folder, uid): Promise<void>

// Bulk Operations (with auto-chunking >50 UIDs)
bulkGetEmails(accountId, folder, uids[], fields): Promise<(EmailMessage|EmailContent)[]>
bulkMarkEmails(accountId, folder, uids[], action): Promise<void>
bulkDeleteEmails(accountId, folder, uids[], expunge): Promise<void>

// Chunked Operations (explicit control)
bulkGetEmailsChunked(..., chunkSize, onProgress): Promise<(EmailMessage|EmailContent)[]>
bulkMarkEmailsChunked(..., chunkSize, onProgress): Promise<{processed, failed, errors[]}>
bulkDeleteEmailsChunked(..., chunkSize, onProgress): Promise<{processed, failed, errors[]}>

// Copy/Move Operations
bulkCopyEmails(accountId, sourceFolder, uids[], targetFolder): Promise<void>
bulkMoveEmails(accountId, sourceFolder, uids[], targetFolder): Promise<void>

// Folder Operations
listFolders(accountId): Promise<Folder[]>
selectFolder(accountId, folderName): Promise<MailboxInfo>
createFolder/deleteFolder/renameFolder(accountId, ...): Promise<void>

// RFC 9051 Operations
bulkAddKeyword/bulkRemoveKeyword(accountId, folder, uids[], keyword): Promise<void>
appendMessage(accountId, mailbox, content, options): Promise<{uid, uidValidity}>
subscribeMailbox/unsubscribeMailbox(accountId, mailbox): Promise<void>
listSubscribedMailboxes(accountId): Promise<Folder[]>
getMailboxStatus(accountId, mailbox): Promise<MailboxStatus>

// Capabilities
getCapabilities(accountId, forceRefresh?): Promise<ServerCapabilities>

// Metrics
getMetrics(accountId): Promise<ConnectionMetrics>
getOperationMetrics(accountId, operation?): Promise<OperationMetrics[]>
resetMetrics(accountId): void
```

**Configuration**:
```typescript
interface ImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  authTimeout?: number;         // Default: 3000ms
  connTimeout?: number;         // Default: 10000ms
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  operationQueue?: OperationQueueConfig;
}

interface RetryConfig {
  maxAttempts?: number;         // Default: 5
  initialDelay?: number;        // Default: 1000ms
  maxDelay?: number;           // Default: 60000ms
  backoffMultiplier?: number;  // Default: 2
}

interface CircuitBreakerConfig {
  failureThreshold?: number;    // Default: 5 failures → OPEN
  successThreshold?: number;    // Default: 2 successes → CLOSED
  timeout?: number;            // Default: 60000ms before HALF_OPEN
  monitoringWindow?: number;   // Default: 120000ms
}
```

### SmtpService (`src/services/smtp-service.ts`)

**Responsibilities**:
- SMTP email sending via Nodemailer
- Reply and forward operations
- Attachment handling
- SMTP configuration per account

**Key Methods**:
```typescript
sendEmail(accountId, account, emailComposer): Promise<string>
```

**Configuration**:
```typescript
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;              // true for SSL/TLS
  user?: string;
  password?: string;
  authMethod?: 'PLAIN' | 'LOGIN' | 'CRAM-MD5' | 'XOAUTH2';
}
```

### DatabaseService (`src/services/database-service.ts`)

**Responsibilities**:
- SQLite database management
- User authentication and authorization
- Account CRUD with encryption
- Multi-user isolation via MCP_USER_ID
- Credential encryption (AES-256-GCM)

**Key Methods**:
```typescript
// User Management
createUser(username, password?): User
getUserById(userId): User
getUserByUsername(username): User

// Account Management
createAccount(accountData): Account
getAccount(accountId): Account (encrypted)
getDecryptedAccount(accountId): DecryptedAccount
listAccountsForUser(userId): Account[]
listDecryptedAccountsForUser(userId): DecryptedAccount[]
deleteAccount(accountId): void

// Capabilities Storage (Issue #58)
updateAccountCapabilities(accountId, capabilities): void
getAccountCapabilities(accountId): ServerCapabilities
```

**Database Schema** (`src/database/schema.sql`):
```sql
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,  -- bcrypt hash (optional, for web UI)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username_encrypted BLOB NOT NULL,  -- AES-256-GCM encrypted
  password_encrypted BLOB NOT NULL,  -- AES-256-GCM encrypted
  tls BOOLEAN DEFAULT 1,
  is_active BOOLEAN DEFAULT 1,

  -- SMTP Configuration (optional)
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure BOOLEAN,
  smtp_username_encrypted BLOB,     -- AES-256-GCM encrypted
  smtp_password_encrypted BLOB,     -- AES-256-GCM encrypted

  -- Server Capabilities (Issue #58)
  server_capabilities TEXT,          -- JSON serialized
  capabilities_updated_at DATETIME,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Additional tables for integrations
CREATE TABLE cleantalk_api_keys (...);
CREATE TABLE dns_firewall_entries (...);
CREATE TABLE scoring_data (...);
CREATE TABLE usercheck_data (...);
```

---

## Email Provider Presets

### Provider List (15 providers)

Defined in `src/providers/email-providers.ts`:

| ID | Name | IMAP Host | IMAP Port | SMTP Host | SMTP Port | App Password Required | OAuth2 Supported |
|----|------|-----------|-----------|-----------|-----------|----------------------|------------------|
| gmail | Gmail | imap.gmail.com | 993 (SSL) | smtp.gmail.com | 465 (SSL) | ✅ | ✅ |
| outlook | Outlook | outlook.office365.com | 993 (TLS) | smtp-mail.outlook.com | 587 (STARTTLS) | ❌ | ✅ |
| yahoo | Yahoo | imap.mail.yahoo.com | 993 (SSL) | smtp.mail.yahoo.com | 465 (SSL) | ✅ | ❌ |
| icloud | iCloud | imap.mail.me.com | 993 (SSL) | smtp.mail.me.com | 587 (STARTTLS) | ✅ | ❌ |
| aol | AOL | imap.aol.com | 993 (SSL) | smtp.aol.com | 465 (SSL) | ✅ | ❌ |
| gmx | GMX | imap.gmx.net | 993 (SSL) | mail.gmx.net | 587 (STARTTLS) | ❌ | ❌ |
| webde | Web.de | imap.web.de | 993 (SSL) | smtp.web.de | 587 (STARTTLS) | ❌ | ❌ |
| ionos | IONOS (1&1) | imap.ionos.de | 993 (SSL) | smtp.ionos.de | 587 (STARTTLS) | ❌ | ❌ |
| mailbox | Mailbox.org | imap.mailbox.org | 993 (TLS) | smtp.mailbox.org | 587 (STARTTLS) | ❌ | ❌ |
| posteo | Posteo | posteo.de | 993 (TLS) | posteo.de | 587 (STARTTLS) | ❌ | ❌ |
| office365 | Office 365 | outlook.office365.com | 993 (TLS) | smtp.office365.com | 587 (STARTTLS) | ❌ | ✅ |
| zoho | Zoho | imap.zoho.com | 993 (SSL) | smtp.zoho.com | 465 (SSL) | ❌ | ❌ |
| protonmail | ProtonMail | 127.0.0.1 | 1143 (STARTTLS) | 127.0.0.1 | 1025 (STARTTLS) | ❌ | ❌ |
| fastmail | Fastmail | imap.fastmail.com | 993 (SSL) | smtp.fastmail.com | 465 (SSL) | ✅ | ❌ |
| hostinger | Hostinger | imap.hostinger.com | 993 (TLS) | smtp.hostinger.com | 465 (TLS) | ❌ | ❌ |
| custom | Custom | (manual) | 993 | (manual) | 587 | ❌ | ❌ |

**Auto-Detection Domains**:
```typescript
getProviderByEmail("user@gmail.com")      → Gmail preset
getProviderByEmail("user@outlook.com")    → Outlook preset
getProviderByEmail("user@yahoo.com")      → Yahoo preset
getProviderByEmail("user@company.com")    → null (use custom)
```

---

## Reliability Features

### 1. Circuit Breaker Pattern

**Purpose**: Prevent cascading failures by stopping operations when too many errors occur.

**States**:
- **CLOSED**: Normal operation
- **OPEN**: Too many failures, reject all requests
- **HALF_OPEN**: Testing if service recovered

**Configuration**:
- `failureThreshold`: 5 failures → Opens circuit
- `successThreshold`: 2 successes → Closes circuit
- `timeout`: 60000ms before trying HALF_OPEN
- `monitoringWindow`: 120000ms rolling window

**Implementation**: `src/services/imap-service.ts:1110-1148`

### 2. Auto-Chunking (Threshold: 50 UIDs)

**Purpose**: Automatically split large operations to prevent timeouts and circuit breaker trips.

**Behavior**:
```
If UIDs ≤ 50:  Use standard bulk processing (single request)
If UIDs > 50:  Automatically use chunked processing
              - Split into chunks of 100 UIDs
              - Process sequentially with 100ms delay
              - Continue on chunk failure
              - Return {processed, failed, errors[]}
```

**Affected Tools**:
- `imap_bulk_get_emails` (auto-chunks at >50)
- `imap_bulk_mark_emails` (auto-chunks at >50)
- `imap_bulk_delete_emails` (auto-chunks at >50)

**Implementation**: `src/tools/email-tools.ts:500-540`

### 3. Connection Pooling & Reconnection

**Features**:
- Active connection pool per account
- Automatic reconnection with exponential backoff
- Connection state tracking (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, ERROR)
- Connection metadata (last connected time, reconnect attempts)

**Reconnection Logic**:
- Initial delay: 1000ms
- Max delay: 60000ms
- Backoff multiplier: 2x
- Max attempts: 5

### 4. Operation Queue (Max Size: 1000)

**Purpose**: Queue operations when connection unavailable, process when reconnected.

**Features**:
- FIFO queue with size limit
- Priority-based sorting
- Max 3 retries per operation
- Automatic processing every 5 seconds

**Implementation**: `src/services/imap-service.ts:74-158`

### 5. Retry Logic with Backoff

**Wrapper**: `withRetry()` function on all IMAP operations

**Configuration**:
- Max attempts: 5
- Initial delay: 1000ms
- Max delay: 60000ms
- Backoff multiplier: 2x

### 6. Metrics & Monitoring

**Connection Metrics**:
- Total operations
- Successful/failed operations
- Average latency
- Uptime
- Last operation time

**Operation Metrics** (per operation type):
- Call count
- Success/failure counts
- Average/min/max latency
- Total latency

**Storage**: LRU cache (max 1000 entries) to prevent memory growth

---

## Security

### Credential Encryption

**Algorithm**: AES-256-GCM (Galois/Counter Mode)

**Key Storage**:
- Master key: `~/.config/imap-mcp/master.key` (auto-generated)
- Permissions: 600 (user read/write only)
- Key rotation: Not currently supported (TODO)

**Encrypted Fields**:
- `username_encrypted` (IMAP)
- `password_encrypted` (IMAP)
- `smtp_username_encrypted` (SMTP)
- `smtp_password_encrypted` (SMTP)

**Implementation**: `src/services/database-service.ts:encrypt/decrypt methods`

### Multi-User Isolation

**Environment Variable**: `MCP_USER_ID`

**Isolation**:
- Each user ID gets separate database entries
- Users cannot access other users' accounts
- Tool context validates user authorization
- Web UI sessions isolated per user

**User Creation**: Automatic on first use of `MCP_USER_ID`

### Best Practices

- ✅ Never log passwords or decrypted credentials
- ✅ Use app-specific passwords for Gmail, Yahoo, etc.
- ✅ Enable 2FA on email accounts
- ✅ Regularly rotate passwords
- ✅ Limit MCP_USER_ID access to trusted users
- ✅ Review `~/.imap-mcp/data.db` permissions (600)

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MCP_USER_ID` | User identifier for multi-tenant isolation | `default` | No |
| `PORT` | Web UI server port | `3000` | No |
| `NODE_ENV` | Environment mode (development/production) | `production` | No |
| `IMAP_MCP_VERSION` | Version identifier (auto-set by installer) | (from package.json) | No |

### File Locations

| Path | Purpose | Permissions |
|------|---------|-------------|
| `~/.config/imap-mcp/credentials.env` | MCP_USER_ID credential | 600 |
| `~/.config/imap-mcp/master.key` | Encryption master key | 600 |
| `~/.imap-mcp/data.db` | SQLite database | 600 |
| `~/.local/share/imap-mcp-pro/` | Installed server files | 755 |
| `~/.local/share/imap-mcp-pro/logs/` | Service logs | 755 |
| `~/Library/LaunchAgents/com.templeofepiphany.imap-mcp-pro.plist` | macOS service (optional) | 644 |

### Claude Desktop Config

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/Users/username/.local/share/imap-mcp-pro/index.js"],
      "env": {
        "MCP_USER_ID": "your-user-id",
        "IMAP_MCP_VERSION": "2.12.0"
      }
    }
  }
}
```

---

## API Endpoints

### Web UI Server (Optional, Port 3000)

**Base URL**: `http://localhost:3000`

#### Account Management

```
GET  /api/accounts          - List accounts for current user
POST /api/accounts          - Create new account
PUT  /api/accounts/:id      - Update account
DELETE /api/accounts/:id    - Delete account
```

#### Provider Presets

```
GET  /api/providers         - List email provider presets
GET  /api/providers/:id     - Get specific provider details
```

#### Test Connection

```
POST /api/test-connection   - Test IMAP/SMTP connection
  Body: { host, port, user, password, tls }
  Response: { success, message, details: { serverCapabilities, folderCount, connectionTime }, error }
```

#### Integration APIs

```
GET  /api/cleantalk/status  - CleanTalk API status
POST /api/dns-firewall      - DNS Firewall operations
GET  /api/scoring           - Email scoring data
POST /api/usercheck         - UserCheck email validation
```

---

## Testing

### Tool Registration Test (`test-tools.js`)

**Purpose**: Verify all MCP tools register correctly

**Command**: `node test-tools.js`

**Expected Output**:
```
✅ 45 tools registered
✅ All tools categorized correctly
✅ No missing or extra tools
✅ PASS
```

### Manual Testing Checklist

**Account Management**:
- [ ] Add account with provider preset
- [ ] Add account with auto-detection
- [ ] Add account manually
- [ ] List accounts
- [ ] Connect to account
- [ ] Disconnect from account
- [ ] Remove account

**Email Operations**:
- [ ] Search emails with criteria
- [ ] Get email content
- [ ] Mark as read/unread
- [ ] Delete single email
- [ ] Bulk operations (<50 UIDs)
- [ ] Bulk operations (>50 UIDs, test auto-chunking)
- [ ] Send email
- [ ] Reply to email
- [ ] Forward email

**Folder Operations**:
- [ ] List folders
- [ ] Get folder status
- [ ] Create/delete/rename folders

**Reliability**:
- [ ] Test circuit breaker (force 5 failures)
- [ ] Test reconnection (disconnect network)
- [ ] Test auto-chunking (>50 UIDs)
- [ ] Test operation queue (offline operations)

### Build & Install Test

```bash
# Build
npm run build

# Test tool registration
node test-tools.js

# Install
make install

# Check service status
make status

# Restart service
make restart
```

---

## Deployment

### Installation Methods

#### 1. Makefile (Recommended)

```bash
# User installation (no sudo required)
make install

# System-wide installation (requires sudo)
sudo make install INSTALL_TYPE=system

# Service management
make start    # Start Web UI service
make stop     # Stop service
make restart  # Restart service
make status   # Check status
make logs     # View logs
```

#### 2. Manual Installation

```bash
# Clone repository
git clone https://github.com/Temple-of-Epiphany/imap-mcp-pro.git
cd imap-mcp-pro

# Install dependencies
npm install

# Build TypeScript
npm run build

# Copy to install directory
mkdir -p ~/.local/share/imap-mcp-pro
cp -r dist/* ~/.local/share/imap-mcp-pro/

# Generate credentials
node dist/scripts/generate-credentials.js

# Update Claude Desktop config
# (See Configuration section)
```

### Platform Support

| Platform | Status | Installation | Service Manager |
|----------|--------|--------------|----------------|
| macOS | ✅ Supported | Makefile | LaunchAgent |
| Linux | ✅ Supported | Makefile | systemd |
| Windows | ⚠️ Partial | install.ps1 | NSSM/Task Scheduler |

### Version Management

**Current Version**: 2.12.0

**Version Update Process**:
1. Update `package.json` version
2. Update `CHANGELOG.md`
3. Update this specification
4. Commit with version tag: `git tag v2.12.0`
5. Push: `git push origin main --tags`
6. Create GitHub release

### Rollback Procedure

```bash
# Backup current database
cp ~/.imap-mcp/data.db ~/.imap-mcp/data.db.backup

# Uninstall current version
make uninstall

# Checkout previous version
git checkout v2.11.0

# Reinstall
make install

# Restore database if needed
cp ~/.imap-mcp/data.db.backup ~/.imap-mcp/data.db
```

---

## Maintenance

### Regular Tasks

**Daily**:
- Monitor service logs: `make logs`
- Check service status: `make status`

**Weekly**:
- Review operation metrics
- Check circuit breaker statistics
- Review failed operation queue

**Monthly**:
- Backup database: `~/.imap-mcp/data.db`
- Rotate credentials (optional)
- Update dependencies: `npm update`
- Security audit: `npm audit`

### Backup Strategy

**Critical Files**:
```bash
# Database backup
cp ~/.imap-mcp/data.db ~/Backups/imap-mcp/data-$(date +%Y%m%d).db

# Master key backup (SECURE LOCATION ONLY)
cp ~/.config/imap-mcp/master.key ~/Backups/imap-mcp/master-key-$(date +%Y%m%d).key

# Configuration backup
cp ~/Library/Application\ Support/Claude/claude_desktop_config.json \
   ~/Backups/imap-mcp/claude-config-$(date +%Y%m%d).json
```

### Troubleshooting

**Common Issues**:

1. **Circuit Breaker Open**
   - Wait 60 seconds for automatic reset
   - Check IMAP server connectivity
   - Review operation metrics: `imap_get_operation_metrics`

2. **Connection Timeouts**
   - Verify IMAP server settings
   - Check firewall rules
   - Increase `connTimeout` in account config

3. **Auto-Chunking Not Working**
   - Verify >50 UIDs in operation
   - Check server logs for "Auto-chunking" messages
   - Review chunked operation results

4. **Provider Preset Not Found**
   - Use `imap_list_providers` to see available presets
   - Check email domain matches provider domains
   - Use `imap_add_account` for unsupported providers

---

## Future Enhancements

### Planned Features (TODO)

**v2.13.0**:
- [ ] Full RFC 9051 compliance audit (Issue #50)
- [ ] Parallel chunking for better throughput
- [ ] Adaptive chunk sizing based on server response time
- [ ] OAuth2 authentication support
- [ ] Key rotation for encryption

**v2.14.0**:
- [ ] Email templates
- [ ] Scheduled email sending
- [ ] Rule-based email automation
- [ ] Advanced search with saved filters
- [ ] Email archiving and compression

**v3.0.0**:
- [ ] Multi-account simultaneous connections
- [ ] Real-time email push notifications (IDLE)
- [ ] WebSocket API for web UI
- [ ] GraphQL API endpoint
- [ ] Plugin system for custom integrations

### Known Limitations

- **ProtonMail**: Requires ProtonMail Bridge (localhost IMAP)
- **OAuth2**: Not yet implemented (requires web flow)
- **IMAP IDLE**: Not exposed via MCP tools
- **Attachment Sending**: Limited to base64 encoding
- **Large Emails**: Content truncated to 10,000 chars in responses

---

## Contact & Support

**Organization**: Temple of Epiphany
**Maintainer**: Colin Bitterfield
**Email**: colin.bitterfield@templeofepiphany.com
**Repository**: https://github.com/Temple-of-Epiphany/imap-mcp-pro
**Issues**: https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues
**Documentation**: https://github.com/Temple-of-Epiphany/imap-mcp-pro/tree/main/docs

---

## Changelog

See `CHANGELOG.md` for detailed version history.

### Recent Major Changes

**v2.12.0** (2025-01-27):
- Added email provider presets with 3 new MCP tools
- Implemented automatic chunking for bulk operations (>50 UIDs)
- Enhanced bulk operations with progress tracking and error recovery
- Added 15 pre-configured email provider presets
- Total tools: 45

**v2.11.0** (2025-01-24):
- Added chunked bulk operations for large-scale processing
- Implemented circuit breaker pattern
- Added comprehensive metrics and monitoring

**v2.10.0** (2025-01-15):
- Added RFC 9051 compliance tools (keywords, APPEND, SUBSCRIBE)
- Implemented STATUS command support
- Added server capabilities detection and caching

---

## License

**Dual-License Model**:
- **Non-Commercial Use**: FREE (personal, educational, non-profit)
- **Commercial Use**: PAID license required

See `LICENSE` file for full terms.

---

**End of Specification Document**

*This document must be updated with each feature addition, architectural change, or version release.*

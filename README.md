# IMAP MCP Pro

An enterprise-grade Model Context Protocol (MCP) server that provides production-ready IMAP email integration with advanced reliability features, comprehensive monitoring, and secure account management.

> **Professional Edition** - Enhanced fork with Level 1-3 reliability features, circuit breaker pattern, metrics, and bulk operations for commercial and large-scale deployments.

## Features

### Core Features
- 🔐 **Secure Account Management**: Encrypted credential storage with AES-256 encryption
- 🚀 **Connection Pooling**: Efficient IMAP connection management
- 📧 **Comprehensive Email Operations**: Search, read, mark, delete emails
- ✉️ **Email Sending**: Send, reply, and forward emails via SMTP
- 📁 **Folder Management**: List folders, check status, get unread counts
- 🔄 **Multiple Account Support**: Manage multiple IMAP accounts simultaneously
- 🛡️ **Type-Safe**: Built with TypeScript for reliability
- 🌐 **Web-Based Setup Wizard**: Easy account configuration with provider presets
- 📱 **15+ Email Providers**: Pre-configured settings for Gmail, Outlook, Yahoo, and more
- 🔗 **Auto SMTP Configuration**: Automatic SMTP settings based on IMAP provider

### Enterprise Features (Pro Edition)

#### Level 1: Enhanced Connectivity
- ⚡ **Enhanced Keepalive**: RFC 2177 compliant NOOP commands every 29 minutes
- 🔌 **Connection Monitoring**: Real-time connection health tracking
- ✅ **Connection Validation**: Proactive connection state verification

#### Level 2: Advanced Reliability
- 🔄 **Automatic Reconnection**: Exponential backoff (1s → 2s → 4s → 8s → 60s max)
- ♻️ **Retry Logic**: Transparent retry wrapper for all operations (max 5 attempts)
- 🏥 **Health Checks**: Periodic NOOP every 29 minutes to prevent timeouts
- 📊 **Connection State Machine**: DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → ERROR
- ⚡ **Bulk Operations**: Efficient bulk delete, read, and mark operations

#### Level 3: Production-Grade Resilience
- 🛡️ **Circuit Breaker**: Prevents cascading failures (5 failures opens, 2 successes closes)
- 📦 **Operation Queue**: Queues operations during outages, replays when reconnected (1000 max)
- 📈 **Comprehensive Metrics**: Per-connection and per-operation metrics (ops, success rate, latency, uptime%)
- 🎯 **Graceful Degradation**: Read-only mode, result caching (5-min TTL), fallback to last known good data
- 🔍 **Enhanced Monitoring**: Real-time metrics via MCP tools (imap_get_metrics, imap_get_operation_metrics)

## Installation

### Quick Install (Recommended)

#### macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/Temple-of-Epiphany/imap-mcp-pro/main/install.sh | bash
```

#### Windows (PowerShell as Administrator):
```powershell
iwr -useb https://raw.githubusercontent.com/Temple-of-Epiphany/imap-mcp-pro/main/install.ps1 | iex
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/Temple-of-Epiphany/imap-mcp-pro.git
cd imap-mcp-pro
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Account Setup

### Web-Based Setup Wizard (Recommended)

After installation, run the setup wizard:

```bash
npm run setup
```

Or if installed globally:

```bash
imap-setup
```

This will:
1. Start a local web server
2. Open your browser to the setup wizard
3. Guide you through adding email accounts with pre-configured settings

### Supported Email Providers

The setup wizard includes pre-configured settings for:
- Gmail / Google Workspace
- Microsoft Outlook / Hotmail / Live
- Yahoo Mail
- Apple iCloud Mail
- GMX
- WEB.DE
- IONOS (1&1)
- ProtonMail (with Bridge)
- Fastmail
- Zoho Mail
- AOL Mail
- mailbox.org
- Posteo
- Custom IMAP servers

## Configuration

### Claude Desktop Configuration

Add the IMAP MCP server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/path/to/ImapClient/dist/index.js"],
      "env": {}
    }
  }
}
```

## Usage

Once configured, the IMAP MCP server provides the following tools in Claude:

### Account Management

- **imap_add_account**: Add a new IMAP account
  ```
  Parameters:
  - name: Friendly name for the account
  - host: IMAP server hostname
  - port: Server port (default: 993)
  - user: Username
  - password: Password
  - tls: Use TLS/SSL (default: true)
  ```

- **imap_list_accounts**: List all configured accounts

- **imap_remove_account**: Remove an account
  ```
  Parameters:
  - accountId: ID of the account to remove
  ```

- **imap_connect**: Connect to an account
  ```
  Parameters:
  - accountId OR accountName: Account identifier
  ```

- **imap_disconnect**: Disconnect from an account
  ```
  Parameters:
  - accountId: Account to disconnect
  ```

### Email Operations

- **imap_search_emails**: Search for emails
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - from, to, subject, body: Search criteria
  - since, before: Date filters
  - seen, flagged: Status filters
  - limit: Max results (default: 50)
  ```

- **imap_get_email**: Get full email content
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_get_latest_emails**: Get recent emails
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - count: Number of emails (default: 10)
  ```

- **imap_mark_as_read/unread**: Change email read status
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_delete_email**: Delete an email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_send_email**: Send a new email
  ```
  Parameters:
  - accountId: Account ID to send from
  - to: Recipient email address(es)
  - subject: Email subject
  - text: Plain text content (optional)
  - html: HTML content (optional)
  - cc: CC recipients (optional)
  - bcc: BCC recipients (optional)
  - replyTo: Reply-to address (optional)
  - attachments: Array of attachments (optional)
    - filename: Attachment filename
    - content: Base64 encoded content
    - path: File path to attach
    - contentType: MIME type
  ```

- **imap_reply_to_email**: Reply to an existing email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder containing the original email
  - uid: UID of the email to reply to
  - text: Plain text reply content (optional)
  - html: HTML reply content (optional)
  - replyAll: Reply to all recipients (default: false)
  - attachments: Array of attachments (optional)
  ```

- **imap_forward_email**: Forward an existing email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder containing the original email
  - uid: UID of the email to forward
  - to: Forward to email address(es)
  - text: Additional text to include (optional)
  - includeAttachments: Include original attachments (default: true)
  ```

- **imap_copy_email**: Copy an email to another folder
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Source folder name (default: INBOX)
  - uid: Email UID to copy
  - targetFolder: Target folder name
  ```

- **imap_bulk_copy_emails**: Bulk copy multiple emails to another folder
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Source folder name (default: INBOX)
  - uids: Array of email UIDs to copy
  - targetFolder: Target folder name
  ```

- **imap_move_email**: Move an email to another folder
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Source folder name (default: INBOX)
  - uid: Email UID to move
  - targetFolder: Target folder name
  ```

- **imap_bulk_move_emails**: Bulk move multiple emails to another folder
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Source folder name (default: INBOX)
  - uids: Array of email UIDs to move
  - targetFolder: Target folder name
  ```

### Folder Operations

- **imap_list_folders**: List all folders
  ```
  Parameters:
  - accountId: Account ID
  ```

- **imap_folder_status**: Get folder information
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  ```

- **imap_get_unread_count**: Count unread emails
  ```
  Parameters:
  - accountId: Account ID
  - folders: Specific folders (optional)
  ```

## Security

- Credentials are encrypted using AES-256-CBC encryption
- Encryption keys are stored separately in `~/.imap-mcp/.key`
- Account configurations are stored in `~/.imap-mcp/accounts.json`
- Never commit or share your encryption key or account configurations

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Project Structure

```
src/
├── index.ts           # MCP server entry point
├── services/
│   ├── imap-service.ts    # IMAP connection management
│   ├── smtp-service.ts    # SMTP service for sending emails
│   └── account-manager.ts # Account configuration
├── tools/
│   ├── index.ts          # Tool registration
│   ├── account-tools.ts  # Account management tools
│   ├── email-tools.ts    # Email operation tools (including send/reply/forward)
│   └── folder-tools.ts   # Folder operation tools
└── types/
    └── index.ts          # TypeScript type definitions
```

## Example Usage in Claude

1. **Add an account:**
   "Add my Gmail account with username john@gmail.com"

2. **Check new emails:**
   "Show me the latest 5 emails from my Gmail account"

3. **Search emails:**
   "Search for emails from boss@company.com in the last week"

4. **Send an email:**
   "Send an email to client@example.com with subject 'Project Update'"

5. **Reply to emails:**
   "Reply to the latest email from my boss"

6. **Forward emails:**
   "Forward the email with subject 'Meeting Notes' to team@company.com"

7. **Manage folders:**
   "List all folders in my email account and show unread counts"

## Troubleshooting

### Connection Issues

- Ensure your IMAP server settings are correct
- Check if your email provider requires app-specific passwords
- Verify that IMAP is enabled in your email account settings
- For sending emails, ensure your account has SMTP access enabled

### SMTP Configuration

The server automatically configures SMTP settings based on your IMAP provider. If you need custom SMTP settings, you can specify them when adding an account:

```json
{
  "smtp": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false
  }
}
```

### Common IMAP Settings

- **Gmail**: 
  - Host: imap.gmail.com
  - Port: 993
  - Requires app-specific password

- **Outlook/Hotmail**:
  - Host: outlook.office365.com
  - Port: 993

- **Yahoo**:
  - Host: imap.mail.yahoo.com
  - Port: 993
  - Requires app-specific password

## License

This software is available under a **Dual License Model**:

### Non-Commercial License (FREE)
Free for personal, educational, and non-profit use. See [LICENSE](LICENSE) for full terms.

### Commercial License (PAID)
Required for any commercial use, including:
- Business email operations
- SaaS products
- Enterprise deployments
- Revenue-generating services

**Contact for Commercial License:** colin@bitterfield.com

## Attribution

This project is an enterprise-enhanced fork of the original IMAP MCP Server created by Michael Nikolaus.

**Original Project:** https://github.com/nikolausm/imap-mcp-server
**Original Author:** Michael Nikolaus
**Original License:** MIT License (applies to base code only)

Temple of Epiphany has added extensive enterprise features (Levels 1-3) which are subject to the dual-license model above.

## Contributing

We welcome contributions! For commercial use contributions, contributors agree that their contributions will be subject to the project's dual-license model.

Please feel free to submit Pull Requests for:
- Bug fixes
- Documentation improvements
- New features
- Performance enhancements

For major changes, please open an issue first to discuss what you would like to change.
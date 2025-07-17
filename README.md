# IMAP MCP Server

A powerful Model Context Protocol (MCP) server that provides seamless IMAP email integration with secure account management and connection pooling.

## Features

- 🔐 **Secure Account Management**: Encrypted credential storage with AES-256 encryption
- 🚀 **Connection Pooling**: Efficient IMAP connection management
- 📧 **Comprehensive Email Operations**: Search, read, mark, delete emails
- 📁 **Folder Management**: List folders, check status, get unread counts
- 🔄 **Multiple Account Support**: Manage multiple IMAP accounts simultaneously
- 🛡️ **Type-Safe**: Built with TypeScript for reliability
- 🌐 **Web-Based Setup Wizard**: Easy account configuration with provider presets
- 📱 **15+ Email Providers**: Pre-configured settings for Gmail, Outlook, Yahoo, and more

## Installation

### Quick Install (Recommended)

#### macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/nikolausm/imap-mcp-server/main/install.sh | bash
```

#### Windows (PowerShell as Administrator):
```powershell
iwr -useb https://raw.githubusercontent.com/nikolausm/imap-mcp-server/main/install.ps1 | iex
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/nikolausm/imap-mcp-server.git
cd imap-mcp-server
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
│   └── account-manager.ts # Account configuration
├── tools/
│   ├── index.ts          # Tool registration
│   ├── account-tools.ts  # Account management tools
│   ├── email-tools.ts    # Email operation tools
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

4. **Manage folders:**
   "List all folders in my email account and show unread counts"

## Troubleshooting

### Connection Issues

- Ensure your IMAP server settings are correct
- Check if your email provider requires app-specific passwords
- Verify that IMAP is enabled in your email account settings

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

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
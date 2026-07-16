# IMAP MCP Server

A powerful Model Context Protocol (MCP) server that provides seamless IMAP email integration with secure account management and connection pooling.

## Features

- 🔐 **Secure Account Management**: Encrypted credential storage with AES-256 encryption
- 🚀 **Connection Pooling**: Efficient IMAP connection management
- 📧 **Comprehensive Email Operations**: Search, read, move, mark, delete, and bulk delete emails
- ✉️ **Email Sending**: Send, reply, and forward emails via SMTP
- 📁 **Folder Management**: List folders, check status, get unread counts
- 🔄 **Multiple Account Support**: Manage multiple IMAP accounts simultaneously
- 🛡️ **Type-Safe**: Built with TypeScript for reliability
- 🌐 **Web-Based Setup Wizard**: Easy account configuration with provider presets
- 📱 **15+ Email Providers**: Pre-configured settings for Gmail, Outlook, Yahoo, and more
- 🔗 **Auto SMTP Configuration**: Automatic SMTP settings based on IMAP provider

## Installation

### Run via npx (No Installation Required)

Once published to npm, you can run the server directly without cloning or building anything — `npx` downloads the prebuilt package and runs it:

```bash
npx -y imap-mcp-server
```

This is the easiest way to use the server in an MCP client (see [Configuration](#configuration) for ready-to-paste `npx` configs).

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

Accounts are stored encrypted in `~/.imap-mcp/accounts.json`. This file is **shared by all run modes** — whether you start the server via `npx`, a global install, or a local clone, they all read the same accounts. So you only need to set up your accounts once.

### Setting Up Accounts in npx Mode

If you run the server via `npx` (no clone), you have two ways to add accounts:

**Option A — Run the setup wizard directly via npx (no install needed):**

```bash
npx -p imap-mcp-server imap-setup
```

This launches the same web-based wizard described below and writes to `~/.imap-mcp/accounts.json`, which your `npx`-configured MCP server then picks up automatically.

**Option B — Add accounts straight from your AI client:**

Once the MCP server is configured, just ask your assistant to add an account — it uses the `imap_add_account` tool. For example:

> "Add my IMAP account: host imap.gmail.com, port 993, user me@gmail.com, password …"

No separate setup step required.

### Web-Based Setup Wizard (Recommended)

After installation, run the setup wizard:

```bash
npm run setup
```

Or if installed globally:

```bash
imap-setup
```

Or directly via npx without installing:

```bash
npx -p imap-mcp-server imap-setup
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

### Claude Code (CLI)

#### Option A — via npx (no clone/build needed)

```bash
claude mcp add imap -- npx -y imap-mcp-server
```

This always runs the latest published version and requires no local build.

#### Option B — from a local clone

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in the terminal, add the MCP server with a single command:

**Step 1:** Make sure you have built the project first (see [Manual Installation](#manual-installation)).

**Step 2:** Run this command in your terminal:

```bash
claude mcp add imap -- node /absolute/path/to/imap-mcp-server/dist/index.js
```

> **Important:** Replace `/absolute/path/to/imap-mcp-server` with the actual path where you cloned the repository. For example:
> ```bash
> # macOS/Linux example:
> claude mcp add imap -- node /Users/yourname/imap-mcp-server/dist/index.js
>
> # Windows example:
> claude mcp add imap -- node C:\Users\yourname\imap-mcp-server\dist\index.js
> ```

**Step 3:** Verify it was added:

```bash
claude mcp list
```

You should see `imap` in the list of configured MCP servers. That's it — the IMAP tools are now available in your Claude Code sessions.

> **Tip:** If you want to remove the server later, run:
> ```bash
> claude mcp remove imap
> ```

### Claude Desktop (GUI App)

Add the IMAP MCP server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Option A — via npx (recommended, no clone/build needed):**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": {}
    }
  }
}
```

**Option B — from a local clone:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/path/to/imap-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### Restricting tool access (read-only mode / allowlist)

By default all tools are exposed. You can restrict which tools the agent sees
using two environment variables (set them under the `env` key of your MCP
config). This is useful when you want to give an assistant **read-only** access
to a mailbox, or expose only a hand-picked subset of tools.

| Variable | Effect |
| --- | --- |
| `IMAP_MCP_READ_ONLY` | When truthy (`1`, `true`, `yes`, `on`), only the safe, read-only tools are registered — searching, reading, listing folders, unread counts, spam analysis. No tool that sends mail, deletes/moves messages, changes flags, or edits accounts is exposed. |
| `IMAP_MCP_ENABLED_TOOLS` | Comma-separated allowlist of tool names — only these are registered. Names are case-insensitive and the `imap_` prefix is optional (`search_emails` ≡ `imap_search_emails`). When set, it takes precedence over `IMAP_MCP_READ_ONLY`. |

**Example — read-only access:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": { "IMAP_MCP_READ_ONLY": "true" }
    }
  }
}
```

**Example — explicit allowlist:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": { "IMAP_MCP_ENABLED_TOOLS": "imap_search_emails,imap_get_email,imap_get_latest_emails" }
    }
  }
}
```

The read-only subset is: `imap_list_accounts`, `imap_connect`, `imap_disconnect`,
`imap_test_account`, `imap_search_emails`, `imap_get_email`,
`imap_get_latest_emails`, `imap_download_attachment`, `imap_find_thread_messages`,
`imap_find_email_by_message_id`, `imap_list_folders`, `imap_folder_status`,
`imap_get_unread_count`, `imap_check_spam`, `imap_domain_stats`,
`imap_list_spam_domains`.

## Usage

Once configured, the IMAP MCP server provides the following tools in Claude:

> **Choosing an account.** For the email and folder tools, `accountId` is
> **optional** and backward-compatible. You may instead pass `accountName`, and
> if you only have a **single** account configured you can omit both — that
> account is used by default. With multiple accounts and no selector, the tool
> returns a clear error listing your options (`imap_list_accounts`).

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
  - folder: Folder name (default: INBOX; ignored when searchAllFolders is true)
  - searchAllFolders: Search across ALL folders at once (default: false).
      Skips Trash/Spam/Drafts and non-selectable folders by default. Use when a
      message may have been filed/moved/archived and you don't know its folder.
  - includeTrash, includeSpam, includeDrafts: Opt those noisy folders back into
      a searchAllFolders run (default: false each)
  - from, to, subject, body: Search criteria
  - since, before: Date filters
  - seen, flagged: Status filters
  - keywords: Match messages with ANY of these custom keywords (server-side OR).
      Read a mailbox's available custom keywords from `imap_folder_status`'s
      `customKeywords` field first.
  - unKeywords: Exclude messages with ANY of these custom keywords (result has
      NONE of them). Same keyword source as `keywords`.
  - limit: Max results (default: 50)
  - includeBody: Include parsed message body in the response (default: false).
      Fetches the RFC822 source once and parses it with mailparser, so you get
      uid + body in a single tool call instead of paying the N+1 cost of one
      `imap_get_email` per match. Body is rendered per `bodyFormat` and capped
      at `bodyMaxLength` per field.
  - bodyFormat: How to render the body when `includeBody` is true — `markdown`
      (default, clean Markdown via Turndown), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap when `includeBody` is true (default: 10000).
  ```
  > With `searchAllFolders`, results include a `folder` field per message plus
  > `foldersSearched`, and any folder that failed to open is reported in
  > `foldersErrored` (so a 0-result answer is never silently incomplete).
  >
  > `includeBody` is honored in the single-folder path only. For a
  > cross-folder sweep the lightweight header shape is preserved by design —
  > pulling RFC822 source for every match across many folders would multiply
  > bandwidth and parse cost. Follow up with `imap_get_email` for the specific
  > uids whose bodies you need.
  >
  > On some servers a "flagged"/starred message carries a custom keyword (e.g.
  > an Open-Xchange color label or Apple's `$MailFlagBit*`) instead of, or in
  > addition to, the `\Flagged` system flag — after any flagged search, check
  > each result's `customKeywords` field before concluding a message is or
  > isn't flagged.

- **imap_get_email**: Get full email content
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  - maxContentLength: Max characters for text/html body (default: 10000)
  - includeAttachmentText: Include text attachment previews (default: true)
  - maxAttachmentTextChars: Max characters per text attachment (default: 100000)
  ```

- **imap_get_latest_emails**: Get recent emails
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - count: Number of emails (default: 10)
  - includeBody: Include parsed message body (default: false). Same semantics
      as the `includeBody` option on `imap_search_emails` — one round-trip
      instead of N×`imap_get_email`.
  - bodyFormat: `markdown` (default), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap (default: 10000).
  ```

- **imap_mark_as_read/unread**: Change email read status
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID, OR an array of UIDs to flag in one call. Batch uses a
      single IMAP STORE so the operation is atomic at the server level — all
      UIDs are flagged, or none. Useful when triaging many messages at once.
  ```

- **imap_flag_email/unflag_email**: Star/unstar an email (sets or clears the IMAP \Flagged system flag — shows as a "star" in Gmail and Apple Mail). Some servers/clients (Open-Xchange, Apple Mail) also set a separate custom keyword (e.g. `$cl_N`, `$MailFlagBit*`) when flagging; unflag only clears `\Flagged`, so if a message still shows as flagged, check `customKeywords` via `imap_get_email` and clear it with `imap_remove_keyword`.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_add_keyword/remove_keyword**: Set or clear an arbitrary *custom* (non-system) IMAP keyword/label on an email, passed through verbatim (e.g. provider color labels like Open-Xchange's `$cl_1`..`$cl_10` or Apple Mail's `$MailFlagBit0`..`$MailFlagBit2`, or any other custom keyword). Backslash-prefixed system flags (e.g. `\Flagged`, `\Seen`, `\Deleted`) are rejected — use the dedicated flag/read tools for those. Not every server permits custom-keyword changes (see the mailbox's PERMANENTFLAGS); if the server rejects or silently ignores the change, the call fails instead of reporting success.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  - keyword: IMAP keyword to set/remove (e.g. "$cl_3")
  ```

- **imap_delete_email**: Delete an email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_move_email**: Move an email from one folder to another
  ```
  Parameters:
  - accountId: Account ID
  - folder: Source folder name (default: INBOX)
  - uid: Email UID, OR an array of UIDs to move in one call. Batch moves are
      attributed per-uid in the response (`results[]` with per-uid `uidMap`
      and any errors). Single-uid calls return the legacy response shape.
  - targetFolder: Destination folder name
  - createDestinationIfMissing: Create the destination folder if it does not exist (default: false)
  ```

- **imap_find_thread_messages**: Find inbox messages that belong to the same conversation threads as messages already sorted into another folder. Uses RFC 3501 HEADER search on In-Reply-To and References — works on any IMAP server.
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Folder containing the already-sorted thread messages
  - searchFolder: Folder to search for related messages (default: INBOX)
  - searchReferences: Also match the References header for multi-level threads (default: true)
  - includeBody: Include parsed message body for each found thread message
      (default: false). Same semantics as the `includeBody` option on
      `imap_search_emails` — one round-trip instead of N×`imap_get_email`.
  - bodyFormat: `markdown` (default), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap (default: 10000).
  ```

- **imap_download_attachment**: Download an email attachment (returns images inline, extracts text from PDFs, or saves to downloads directory)
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - uid: Email UID
  - filename: Attachment filename or contentId
  - savePath: Optional file path to save the attachment to
  - extractText: For PDFs, extract and return text content inline (default: true)
  ```

- **imap_bulk_delete**: Delete multiple emails at once with chunking and auto-reconnection
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - uids: Array of email UIDs to delete
  - chunkSize: Emails to delete per batch (default: 50)
  ```

- **imap_bulk_delete_by_search**: Search for emails matching criteria and delete them all
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - from, to, subject: Search criteria (optional)
  - before, since: Date filters (optional)
  - chunkSize: Emails to delete per batch (default: 50)
  - dryRun: Preview what would be deleted without deleting (default: false)
  ```
  At least one concrete criterion (`from`, `to`, `subject`, `before`, or `since`)
  is required — a call with no criteria is refused, so it can never match and
  delete an entire folder.

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
    - contentDisposition: "attachment" (default) or "inline" — use "inline" for images shown in the HTML body via cid:
    - cid: Content-ID for inline attachments; must match the `cid:` value used in an `<img src="cid:...">` tag in `html`
  ```

- **imap_save_draft**: Save an email as a draft (no send). Takes the same fields as `imap_send_email`, plus `inReplyTo`, `references`, and an optional `folder` override for the Drafts folder.

- **imap_reply_to_email**: Reply to an existing email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder containing the original email
  - uid: UID of the email to reply to
  - text: Plain text reply content (optional)
  - html: HTML reply content (optional)
  - replyAll: Reply to all recipients (default: false)
  - attachments: Array of attachments (optional, same shape as imap_send_email, including contentDisposition/cid for inline images)
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

- **imap_create_folder**: Create a new IMAP folder/mailbox. Most servers also create any missing parent folders. Returns success even if the folder already exists.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Full folder path to create (e.g. "Archives/2026/2026-05" or "INBOX.Archive")
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
- The store directory, `.key`, and `accounts.json` are written owner-only
  (`0700`/`0600`) so other local users cannot read the key or the credentials
- The web setup wizard's HTTP API never returns stored passwords to the browser
- Downloaded attachments are confined to the downloads directory; sender-supplied
  filenames cannot write outside it
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

7. **Move an email:**
   "Move the invoice email from INBOX to my Taxes folder"

8. **Manage folders:**
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

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

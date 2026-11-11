# IMAP MCP Server

[![MCPVault: claimed](https://mcpvault.io/badge/imap-mcp-server.svg)](https://mcpvault.io/servers/imap-mcp-server/health?utm_source=external_badge&utm_medium=referral&utm_campaign=mcp_health_report)

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

> **Requires Node.js 22.12 or newer.** Node 18 and 20 have both reached
> end-of-life, and several of this package's dependencies no longer support
> them. Check yours with `node --version`.

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

The wizard listens on `127.0.0.1` only, so nothing else on your network can
reach it.

#### Running the wizard on another machine (server, NAS, VM)

**Recommended: SSH tunnel.** The wizard stays on loopback, and the connection is
encrypted:

```bash
ssh -L 3000:localhost:3000 my-server      # then, on the server:
imap-setup --no-open
```

Open `http://localhost:3000` in your local browser.

**Alternative: bind to the network.** Pass `--host` (or set `IMAP_MCP_BIND`):

```bash
imap-setup --host 0.0.0.0 --no-open
```

The wizard then requires an access token and prints a URL containing it, e.g.
`http://my-server:3000/?token=…`. Open that URL; the token is exchanged for a
session cookie and removed from the address bar. Requests without the token are
refused, and so are cross-origin requests. Scripts can send
`Authorization: Bearer <token>` instead. To use a fixed token rather than a
random one per start, set `IMAP_MCP_WIZARD_TOKEN` (at least 16 characters); it is then not printed.

The connection is plain HTTP, so anyone who can read your network traffic can
see the token and the passwords you enter. Use this only on networks you trust,
and prefer the SSH tunnel otherwise.

| Variable | Default | Meaning |
|---|---|---|
| `IMAP_MCP_BIND` | `127.0.0.1` | Address the wizard binds to (`--host` takes precedence) |
| `IMAP_MCP_WIZARD_TOKEN` | random per start | Access token when bound beyond loopback |
| `PORT` | `3000` | Port for `npm run web` (`imap-setup` uses `--port`) |

### Overriding Credentials via Environment Variables

You can override the username and password of an already-configured account at
runtime with environment variables — useful when you inject secrets from a
password manager or CI system instead of storing them in `accounts.json`.

The variables are keyed by the account **name**, uppercased with every
non-alphanumeric character replaced by `_`. For an account named `Work Gmail`
(key `WORK_GMAIL`):

| Variable | Overrides |
| --- | --- |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME` | IMAP username (`user`) |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD` | IMAP password |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_USERNAME` | SMTP username (`smtp.user`) |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_PASSWORD` | SMTP password |

Notes:
- Overrides apply **only to existing accounts**; if no account's normalized name
  matches, the variable is ignored.
- They are applied **in memory only** — nothing is written back to
  `accounts.json`, and the values are used as-is (not re-encrypted).
- Variables are **consumed at startup**: on server start they are captured into
  an AES-256-encrypted in-memory cache and removed from `process.env`, so the
  plaintext secret does not linger in the environment (where it could leak to
  child processes or diagnostics). Set them before launching the server.

The setup wizard integrates with this: each credential field (IMAP password,
IMAP username, SMTP username, SMTP password) has a **"Do not save to config; set
later using an environment variable"** checkbox. When ticked, the value you enter
is still used to test the connection, but it is not written to `accounts.json` —
the wizard shows the exact variable name to export, and the account picks the
credential up from that variable at runtime.
- SMTP variables take effect only when the account already has an SMTP config.
- Each variable takes effect independently; set only the ones you need.

**If the variable is missing**, the account still holds the empty placeholder the
wizard wrote. Rather than dialing out with a blank credential — which providers
answer with a generic authentication failure that looks exactly like a wrong
password — the server refuses the connection and names what to set:

```
Account "Work Gmail" has IMAP credentials marked as environment-managed, but
this variable was not set when the server started:
IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD. Set it and restart the server, or
store the credentials on the account via imap_update_account.
```

Because the variables are read once at startup, setting one in an already-running
shell has no effect until the server is restarted.

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
| `IMAP_MCP_READ_ONLY` | When truthy (`1`, `true`, `yes`, `on`), only the safe, read-only tools are registered — searching, reading, listing folders, unread counts, spam analysis. No tool that sends mail, deletes/moves/copies messages, changes flags, or edits accounts is exposed. |
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
  - allowStartTLS: When tls is false, set to false to also disable the
      opportunistic STARTTLS upgrade imapflow otherwise attempts whenever the
      server advertises it (validating the cert against `host` regardless of
      `tls`). Needed for providers that advertise STARTTLS on a hostname
      covered only by a shared/wildcard cert. Defaults to true.
  - sentFolder: Explicit Sent-folder name for sent-mail copies, e.g. "Gesendet"
      (optional — only needed when the server has no \Sent SPECIAL-USE folder
      and auto-detection fails)
  - defaultBcc: Optional BCC address(es) applied automatically to every
      outbound send, reply, forward, and draft for this account. Merged with
      any per-call `bcc` (duplicates removed case-insensitively)
  - allowedFrom: Optional list of additional sender identities permitted in
      outbound `From` headers. The account email and login are always allowed
  - provider: Optional provider id from the built-in provider list ("gmail",
      "protonmail", ...). When unset, the provider is recognised by IMAP host.
      Set it when the host differs from the provider's standard one (e.g.
      Proton Mail Bridge via a Docker hostname). Provider-specific rules, such
      as the imap_copy_email copy policy, depend on it
  ```

- **imap_update_account**: Update an existing account (fix SMTP settings, rename, etc.)
  ```
  Parameters:
  - accountId: ID of the account to update
  - name, host, port, user, password, tls, allowStartTLS, email: IMAP fields (all optional)
  - smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword: SMTP fields (optional)
  - saveToSent: Save sent emails to the Sent folder (optional)
  - sentFolder: Explicit Sent-folder override (optional). Pass an empty string
      to clear the override and re-enable auto-detection
  - defaultBcc: Optional default BCC address(es) (optional). Pass an empty
      string to clear
  - allowedFrom: Optional list of additional sender identities. Pass an empty
      array to clear
  - provider: Provider id (optional). Pass an empty string to clear it and fall
      back to host matching
  ```

`allowedFrom` is an application-level guardrail, not a hard security boundary:
an agent with access to `imap_update_account` can change the allowed identities.
The SMTP server must enforce the actual sender authorization policy. Sender
mailbox addresses are matched case-insensitively; the supplied display name and
address casing are preserved in the outbound `From` header. This applies to
sending, drafts, replies, and forwards.

- **imap_list_accounts**: List all configured accounts. Each entry includes `provider`: the provider id in effect (explicit, or recognised by host), or `null`.

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

- **imap_copy_email**: Copy emails to another folder in the same account with IMAP `COPY`. The tool itself never moves, flags, deletes or expunges anything. Some providers turn a copy into a move on their side, so each destination is checked against a copy policy first (see below).
  ```
  Parameters:
  - accountId: Account ID
  - folder: Source folder (required, no default)
  - uid: Email UID, or an array of UIDs (duplicates are copied once)
  - targetFolder: Destination folder. Must already exist and differ from
      the source; it is never created.
  - acknowledgeSourceMayChange: Optional. Only needed on servers the tool
      does not recognise (see below).

  Returns:
  - success (all copied), partial (some copied), uncertain (at least one
      outcome unknown)
  - provider: proton | gmail | unknown
  - preservation: verified (the destination is known to keep the original)
      or acknowledged (unrecognised server, caller passed the flag)
  - copiedCount, failedCount, uncertainCount, notAttemptedCount
  - results: [{ uid, status, uidMap?, error? }], where status is
      copied | failed | uncertain | not_attempted. uidMap appears only when
      the server reports it (UIDPLUS COPYUID).
  - on refusal: success: false and a reason — destination_not_found,
      source_not_found, same_folder, no_uids, destination_may_move_source,
      destination_is_trash_or_junk, destination_not_verified or
      preservation_unverified
  ```
  `failed` means definitely not copied: the UID isn't in the source folder, or
  the server refused the copy. `uncertain` means the connection dropped while
  the copy was in flight, so it may have landed. Copying stops there, the
  remaining UIDs are reported `not_attempted`, and nothing is retried. Check
  the destination before calling again, or the message may be duplicated.

  **Copy policy.** Standard IMAP `COPY` (RFC 3501) leaves the original in
  place, but providers whose folders are exclusive (a message can be in only
  one) may turn a copy into a move. The policy is checked before anything is
  sent; a refused copy sends nothing.

  | Account provider | Destination | Result |
  |---|---|---|
  | Any | Trash or Spam/Junk (`\Trash` / `\Junk` special-use) | Refused: `destination_is_trash_or_junk` |
  | `protonmail` | `Labels/<name>` | Copied; adds the label. |
  | `protonmail` | `Folders/<name>`, INBOX, Archive, Sent, Drafts, Starred, All Mail | Refused: `destination_may_move_source` |
  | `gmail` | User label | Copied; adds the label. |
  | `gmail` | INBOX and other `[Gmail]/...` system folders | Refused: `destination_not_verified` |
  | Any other, or none identified | Anything else | Refused: `preservation_unverified`, unless `acknowledgeSourceMayChange: true` |

  The rules come from the `copyBehavior` of the account's entry in the
  provider registry (`src/providers/email-providers.ts`), the same list the
  setup wizard uses. The account's provider is its `provider` field when set
  (the wizard saves the provider card you pick), otherwise the registry entry
  whose IMAP host matches the account's host. `imap_list_accounts` shows the
  provider in effect. Set `provider` explicitly when the host differs from the
  registry's, e.g. Proton Mail Bridge reached through a Docker or LAN hostname
  instead of `127.0.0.1`; without it, such an account counts as unidentified.
  On Proton Mail Bridge, a copy into `Folders/<name>` reports success and at
  first shows the message in both places, but once Bridge syncs with Proton
  the message is gone from its original folder.
  `acknowledgeSourceMayChange` never overrides a refusal. To add another
  provider's rules, see [Adding a provider's copy behaviour](#adding-a-providers-copy-behaviour).

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
  - filename: Attachment filename or contentId (as listed by imap_get_email; NFC/NFD
      spellings of accented characters are treated as equal, and a contentId may
      be passed with or without angle brackets)
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
  delete an entire folder. On servers whose SEARCH is broken (see
  Troubleshooting → Search returns nothing) this tool, `imap_delete_spam` and
  `imap_delete_by_domain` return an error instead of deleting from a
  client-side match.

- **imap_send_email**: Send a new email
  ```
  Parameters:
  - accountId: Account ID to send from
  - from: Sender identity (optional). Must match the account email/login or an
      address configured in `allowedFrom`
  - to: Recipient email address(es) — an array, or a single comma-separated string
  - subject: Email subject
  - text: Plain text content (optional)
  - html: HTML content (optional)
  - cc: CC recipients (optional)
  - bcc: BCC recipients (optional)
  - replyTo: Reply-to address (optional)
  - attachments: Array of attachments (optional)
    - filename: Attachment filename
    - content: Base64 encoded content; provide exactly one of `content` or `path`
    - path: Readable local file path to attach; provide exactly one of `path` or `content`
    - contentType: MIME type (optional; detected from the filename extension when omitted)
    - contentDisposition: "attachment" (default) or "inline" — use "inline" for images shown in the HTML body via cid:
    - cid: Content-ID for inline attachments; must match the `cid:` value used in an `<img src="cid:...">` tag in `html`
  - dryRun: Validate attachments and compose MIME without sending or saving to Sent (optional, default: false)
  ```
  Attachments are validated before SMTP is contacted. Invalid base64, unreadable
  paths, missing filenames, ambiguous sources, and inline attachments without
  `cid` fail fast. Successful sends and dry-runs return `attachmentCount` and
  safe `attachmentDiagnostics`: filename, MIME type, size, source, disposition,
  and cid. Diagnostics omit bytes, raw MIME, and local file paths.

  For large files, upload with `imap_upload_file` first and pass its returned
  local `path`; for inline images, set `contentDisposition: "inline"` and a
  matching `cid`.

  After sending, a copy is saved to the account's Sent folder (unless
  `saveToSent` is disabled on the account). The folder is resolved via the
  account's `sentFolder` override → the server's `\Sent` SPECIAL-USE flag →
  a list of known localized names ("Sent", "Gesendet", "Éléments envoyés", …).
  The response reports the outcome: `savedToSent` (boolean), `sentFolder`
  (the folder used), and — when the save fails — `sentSaveError` explaining
  why, instead of failing silently. The same applies to `imap_reply_to_email`
  and `imap_forward_email`.

  When the account has `defaultBcc` configured, those address(es) are always
  BCC'd on send, reply, forward, and draft (merged with any per-call `bcc`;
  duplicates removed case-insensitively). The Bcc header is kept in the MIME
  stored for drafts and Sent-folder copies so mail clients show it.

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
  - bcc: BCC recipients (optional; merged with account defaultBcc)
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
  - bcc: BCC recipients (optional; merged with account defaultBcc)
  - includeAttachments: Include original attachments (default: true)
  ```

### Folder Operations

- **imap_list_folders**: List all folders
  ```
  Parameters:
  - accountId: Account ID
  ```
  Each folder includes its `attributes` (raw IMAP LIST flags) and, when the
  server advertises it, `specialUse` — the RFC 6154 role (`\Sent`, `\Drafts`,
  `\Trash`, `\Junk`, `\Archive`) that identifies a folder independent of its
  localized display name (e.g. "Gesendet" carries `specialUse: "\Sent"`).

- **imap_folder_status**: Get folder information
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name

  Returns:
  - messages: { total, new, unseen } — from IMAP STATUS
  - uidvalidity, uidnext
  - flags, permanentFlags: string arrays
  - customKeywords: the mailbox's non-system keywords, usable as the
      `keywords` / `unKeywords` input of imap_search_emails
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

### Recipients arriving as `["a@x.com","b@y.com"]`

`to`, `cc`, `bcc`, `references` and `uid` accept either a single value or an
array. In JSON Schema that is an `anyOf`, and some MCP clients drop the `anyOf`
before showing the schema to the model — the field then looks untyped or
string-typed, and the client serializes the model's array into a string. The
server used to pass that string straight to nodemailer, which folded the
literal `[` and `]` into the first and last address, so every recipient was
rejected by the receiving mail server (issue #127).

The server now detects a stringified array and restores it, both when
validating tool input and again before composing the message, and logs a
warning to stderr naming the field. Nothing needs to change on your side. If
you want to bypass the client behavior entirely, pass recipients as one
comma-separated string: `"Alice <alice@example.com>, Bob <bob@example.org>"`.

### Search returns nothing although the folder has mail (Strato)

Since mid-2026 Strato's IMAP server (`imap.strato.com`) answers every SEARCH
command with an empty result, while FETCH still works (issue #138). The server
detects this: when a SEARCH comes back empty for a folder that is not empty and
`SEARCH ALL` is empty as well, it fetches the envelopes and applies the
criteria itself. `imap_search_emails`, `imap_find_thread_messages`, the unread counts and the
spam analysis keep working; `imap_get_latest_emails` never needed SEARCH.

Limits of the fallback:

- It is slower — every envelope of the folder is downloaded per search.
- A `body` search downloads and parses each remaining candidate, so it is
  refused above 2000 candidates; narrow it with `since`/`from`/`subject`.
- Deleting tools (`imap_bulk_delete_by_search`, `imap_delete_spam`,
  `imap_delete_by_domain`) do **not** use it and return an error instead. Find
  the messages with `imap_search_emails` and delete their UIDs with
  `imap_bulk_delete`.

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

### Adding a provider's copy behaviour

`imap_copy_email` only lets a copy through without acknowledgment when the
account's provider has a `copyBehavior` entry in
`src/providers/email-providers.ts` (see the copy policy under
`imap_copy_email`). To add one, find out what COPY does on that provider:

1. Use an account you control and a message you don't mind changing. Create a
   scratch destination of each kind the provider has: an ordinary user folder,
   a label folder if labels have their own prefix (e.g. `Labels/`), and any
   system folder you want to cover (INBOX, Archive, Starred, ...). Never test
   on Trash or Spam; they are refused everywhere.
2. Copy the message into each one with `imap_copy_email` and
   `acknowledgeSourceMayChange: true`.
3. Check the source folder right away and again after the provider has synced
   (a few minutes; also check the webmail). If the message left the source,
   that destination is exclusive: COPY moves.
4. If it stayed, find out whether the copy is a second view of the same
   message (a label) or an independent duplicate: mark it read in one folder
   and see whether it changes in the other, or see whether the total in the
   provider's "All Mail" folder went up.
5. Map the results to the fields: `labelPrefixes` (label folders, COPY keeps
   the original), `unverifiedPrefixes` and `inboxUnverified` (system folders
   you couldn't confirm), and `otherFolders` (`label` if every other folder
   behaved like a label, `exclusive` if any moved the message).
6. Delete the scratch folders. Describe what you tested and the results in the
   pull request, not in code comments, and add a row for the provider to the
   copy-policy table and a case to `tests/copy-policy.test.ts`.

A provider that keeps independent duplicates (standard IMAP) needs no entry:
the acknowledgment path already covers it.

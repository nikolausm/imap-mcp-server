# Security Policy

`imap-mcp-server` connects AI assistants to your email. Because email is highly
sensitive, the project is designed to keep your data **local and under your
control**.

## Security model

- **Local execution.** The server runs entirely on your own machine as a local
  MCP process (stdio). It is not a hosted service and does not require any
  account with this project.
- **Credential storage.** IMAP/SMTP credentials are stored encrypted with
  **AES-256-CBC** in `~/.imap-mcp/accounts.json`. The encryption key is generated
  locally and kept at `~/.imap-mcp/.key`. Protect these files with your OS user
  permissions; anyone who can read both files can read your credentials.
- **No telemetry.** The server collects no analytics, usage data, or crash
  reports.
- **No third-party data sharing.** The only outbound network connections are to
  the IMAP and SMTP servers **you** configure. Email content and credentials are
  never sent anywhere else.
- **Your MCP client sees your mail.** Email content returned by these tools is
  passed to whichever MCP client/LLM you connect (e.g. Claude, ChatGPT, Cursor).
  Review that client's own privacy terms; treat any connected model as a party
  that can read the mailboxes you expose.

## Recommendations for users

- Use **app-specific passwords** where your provider supports them (Gmail,
  iCloud, Yahoo, Fastmail, …) instead of your primary password.
- Keep `~/.imap-mcp/` readable only by your user account.
- Prefer least-privilege accounts/folders when possible.
- Be deliberate with destructive tools (`imap_delete_email`,
  `imap_bulk_delete`, `imap_bulk_delete_by_search`) — use the `dryRun` option to
  preview criteria-based deletions first.

## Reporting a vulnerability (responsible disclosure)

If you discover a security issue, please report it **privately** — do not open a
public issue with exploit details.

- Use GitHub's **[Report a vulnerability](https://github.com/nikolausm/imap-mcp-server/security/advisories/new)**
  (Security → Advisories) to open a private advisory, **or**
- Contact the maintainer via the email on the
  [GitHub profile](https://github.com/nikolausm).

Please include reproduction steps and affected versions. We aim to acknowledge
reports promptly, investigate, and ship a fix with a coordinated disclosure once
a patch is available. Thank you for helping keep users safe.

# Security Policy

`imap-mcp-server` connects AI assistants to your email. Because email is highly
sensitive, the project is designed to keep your data **local and under your
control**.

## Security model

- **Local execution.** The server runs entirely on your own machine as a local
  MCP process (stdio). It is not a hosted service and does not require any
  account with this project.
- **Safe-by-default tool surface.** Unless you opt in to mutating tools
  (`IMAP_MCP_READ_ONLY=false` or `IMAP_MCP_ALLOW_MUTATING=true`, or an explicit
  `IMAP_MCP_ENABLED_TOOLS` allowlist), only read-only tools are registered.
  Prompt injection via email content cannot drive send/delete/account changes
  when the default applies.
- **Filesystem jail.** Attachment `path` values and download `savePath` values
  are confined to `IMAP_DOWNLOAD_DIR` (and optional `IMAP_ATTACHMENT_DIRS`).
  The credential store (`~/.imap-mcp`) is never readable via attachment paths.
- **Credential storage.** IMAP/SMTP credentials in `~/.imap-mcp/accounts.json`
  are obfuscated at rest with **AES-256-CBC**. The key is generated locally and
  kept at `~/.imap-mcp/.key` **next to** the ciphertext. Anyone who can read
  both files can recover plaintext passwords — this is **not** a vault or OS
  keyring. Prefer environment-injected credentials
  (`IMAP_MCP_ACCOUNT_*`) or an OS keyring for real secret management. The store
  directory and both files are written owner-only (`0700`/`0600`) so other local
  users cannot read them on POSIX.
- **Web setup wizard.** Binds **127.0.0.1** by default. Set
  `IMAP_MCP_BIND=0.0.0.0` only on trusted networks. Host/Origin loopback checks
  remain in place; the API is still unauthenticated for local clients.
- **TLS.** Prefer `tls: true` (the default) for IMAP. Cleartext
  (`tls: false` / disabled STARTTLS) sends credentials in the clear — only use
  when a provider requires it and the network path is trusted.
- **No telemetry.** The server collects no analytics, usage data, or crash
  reports.
- **No third-party data sharing.** The only outbound network connections are to
  the IMAP and SMTP servers **you** configure (plus optional spam-scoring APIs
  you enable). Email content and credentials are never sent anywhere else by
  this project.
- **Your MCP client sees your mail.** Email content returned by these tools is
  passed to whichever MCP client/LLM you connect (e.g. Claude, ChatGPT, Cursor).
  Review that client's own privacy terms; treat any connected model as a party
  that can read the mailboxes you expose.

## Recommendations for users

- Leave the **default read-only** tool surface unless you need send/delete.
- Use **app-specific passwords** where your provider supports them (Gmail,
  iCloud, Yahoo, Fastmail, …) instead of your primary password.
- Prefer **env credential overrides** over storing passwords in `accounts.json`.
- Keep `~/.imap-mcp/` readable only by your user account.
- Do not run the web wizard with `IMAP_MCP_BIND=0.0.0.0` on shared/multi-user
  hosts or untrusted LANs.
- Prefer least-privilege accounts/folders when possible.
- Be deliberate with destructive tools (`imap_delete_email`,
  `imap_bulk_delete`, `imap_bulk_delete_by_search`) — use the `dryRun` option to
  preview criteria-based deletions first. `imap_bulk_delete_by_search` requires
  at least one concrete criterion and refuses an empty criteria set, so it can
  never wipe a whole folder by accident.

## Reporting a vulnerability (responsible disclosure)

If you discover a security issue, please report it **privately** — do not open a
public issue with exploit details.

- **Preferred:** use GitHub's **[Report a vulnerability](https://github.com/nikolausm/imap-mcp-server/security/advisories/new)**
  (Security → Advisories) to open a private advisory. Private vulnerability
  reporting is enabled on this repository, so this form works and routes the
  report only to the maintainer.
- **By email:** write to **security.imap-mcp-server@minicon.eu**. Please do not
  include exploit details in an unencrypted first email if you can avoid it —
  a heads-up plus a request for a secure channel is enough to get started.
- **If neither is available to you:** open a regular GitHub issue that says only
  that you have a security report and asks for a private contact channel —
  **without** any details, reproduction steps, or exploit information. The
  maintainer will follow up privately.

Please include reproduction steps and affected versions in the private report.
We aim to acknowledge reports promptly, investigate, and ship a fix with a
coordinated disclosure once a patch is available. Thank you for helping keep
users safe.

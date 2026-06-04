# AGENTS.md

Cross-agent project guide for **imap-mcp-server** — a Model Context Protocol (MCP)
server that gives AI assistants (Claude, ChatGPT, Cursor, …) access to IMAP/SMTP
mailboxes. This file is the shared source of truth for any agent or contributor
working in this repository.

## Architecture

- **Entry point** — `src/index.ts` boots an `McpServer` (MCP SDK) over **stdio**
  and registers all tools via `src/tools/index.ts`.
- **Services** (`src/services/`):
  - `ImapService` — IMAP protocol via **`imapflow`**, with connection pooling,
    folder operations, search, fetch, move/delete, append (Sent/Drafts).
  - `SmtpService` — outbound mail via **`nodemailer`**; composes raw MIME and sends.
  - `AccountManager` — account CRUD with **AES-256-CBC** encrypted credential
    storage at `~/.imap-mcp/accounts.json` (key at `~/.imap-mcp/.key`).
  - `SpamService` — disposable/known-spam domain detection.
- **Tools** (`src/tools/`), grouped by area:
  - `account-tools.ts` — add / update / list / remove / connect / disconnect / test.
  - `email-tools.ts` — search, get, latest, send, reply, forward, save draft,
    mark read/unread, delete, bulk delete, move, attachments, upload, threads.
  - `folder-tools.ts` — list, status, create, unread counts.
  - `spam-tools.ts` — spam analysis, domain stats, allow/deny lists.
- **Web setup wizard** — `src/web/server.ts` (Express) serves `public/` for
  account onboarding (`npm run setup` / `imap-setup`).
- **Types** — `src/types/index.ts`.
- All tools return **JSON-formatted text** content; errors are returned as
  structured JSON where practical rather than thrown for caller-facing failures.

## Build / Test commands

```bash
npm install          # install dependencies
npm run build        # bundle to dist/ via esbuild (build.mjs)
npm test             # run the vitest suite (run mode)
npm run test:watch   # vitest in watch mode
npm run lint         # tsc --noEmit type-check
npm run dev          # run the server from source (tsx watch)
npm run setup        # launch the web setup wizard
```

Always run `npm run build` **and** `npm test` before committing changes that
touch `src/`. Keep the suite green (currently 119 tests).

## Security rules (must follow)

1. **Never log secrets.** Passwords, encryption keys, `accounts.json` contents,
   raw auth tokens, and full message bodies must not be written to stdout/stderr
   or to disk outside the user's mailbox/download directories. When adding logs,
   log identifiers (account id, folder, uid), not credentials.
2. **No destructive mail operations without explicit guard logic.** Deletes,
   bulk deletes, and moves must be driven by explicit caller input. Bulk/criteria
   deletion must keep its `dryRun` path and require concrete criteria — never
   delete a whole folder by default, and never widen a delete beyond what the
   caller specified.
3. **Tool schema changes require docs + tests.** Do not rename existing tools or
   change their input/output shape without (a) updating the tool `description`,
   (b) updating `README.md`, and (c) adding/adjusting tests. Prefer additive,
   backward-compatible changes (new optional fields) over breaking ones.
4. **Credentials stay local.** Do not add telemetry, analytics, crash reporting,
   or any third-party network calls. The only outbound connections are to the
   user's own IMAP/SMTP servers.
5. **Validate and sanitize file paths** for attachment upload/download (already
   done via `path.basename`); keep writes confined to the configured directories.

## Conventions

- TypeScript, ESM (`"type": "module"`), Node ≥ 18.
- Tool names are stable public API: `imap_*`. Do not rename without a strong
  reason and a migration note.
- Zod schemas describe every tool input; every field gets a `.describe()` that
  tells an LLM **when and how** to use it.
- Match the surrounding code style; keep error handling and connection cleanup
  consistent with existing tools.

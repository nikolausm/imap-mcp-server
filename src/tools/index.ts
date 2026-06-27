import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { SpamService } from '../services/spam-service.js';
import { accountTools } from './account-tools.js';
import { emailTools } from './email-tools.js';
import { folderTools } from './folder-tools.js';
import { spamTools } from './spam-tools.js';

/**
 * Read-only / safe-by-default subset of tools.
 *
 * These never mutate a mailbox (no flag changes, moves, or deletes), never send
 * mail, and never change stored accounts or spam lists — they only read mail,
 * folders, and local config. This is the set exposed when `IMAP_MCP_READ_ONLY`
 * is enabled. Keep this list in sync when adding new read-only tools.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
  // Account (non-mutating)
  'imap_list_accounts',
  'imap_connect',
  'imap_disconnect',
  'imap_test_account',
  // Email (read)
  'imap_search_emails',
  'imap_get_email',
  'imap_get_latest_emails',
  'imap_download_attachment',
  'imap_find_thread_messages',
  'imap_find_email_by_message_id',
  // Folder (read)
  'imap_list_folders',
  'imap_folder_status',
  'imap_get_unread_count',
  // Spam (read / analysis only)
  'imap_check_spam',
  'imap_domain_stats',
  'imap_list_spam_domains',
];

/** Normalize a configured tool name: lowercase and add the `imap_` prefix if missing. */
function normalizeToolName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.startsWith('imap_') ? trimmed : `imap_${trimmed}`;
}

/** Parse a comma-separated tool list (forgiving of whitespace, casing, and the `imap_` prefix). */
function parseToolList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeToolName);
}

/** Interpret a boolean-ish env value (`1`, `true`, `yes`, `on`). */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Resolve which tools should be registered based on env configuration.
 *
 * Returns a `Set` of allowed tool names, or `null` to allow **all** tools
 * (the default when nothing is configured).
 *
 * Precedence:
 *  1. `IMAP_MCP_ENABLED_TOOLS` — explicit comma-separated allowlist. When set,
 *     it is authoritative and `IMAP_MCP_READ_ONLY` is ignored.
 *  2. `IMAP_MCP_READ_ONLY` — when truthy, exposes the {@link READ_ONLY_TOOLS} subset.
 *  3. Otherwise → `null` (all tools registered, original behavior).
 */
export function resolveEnabledTools(
  env: NodeJS.ProcessEnv = process.env
): Set<string> | null {
  const explicit = parseToolList(env.IMAP_MCP_ENABLED_TOOLS);
  if (explicit.length > 0) {
    return new Set(explicit);
  }
  if (isTruthy(env.IMAP_MCP_READ_ONLY)) {
    return new Set(READ_ONLY_TOOLS);
  }
  return null;
}

/**
 * Wrap an {@link McpServer} so that `registerTool` only registers tools whose
 * name is in `allowed`. All other server methods are forwarded unchanged.
 *
 * `seen` collects every tool name the registrars attempt to register, so the
 * caller can warn about configured names that don't match any real tool.
 *
 * Note: the Proxy is built over `any` and only cast to `McpServer` at the
 * boundary. McpServer's `registerTool` generic is very deep, so typing the
 * Proxy against it adds avoidable type-instantiation cost; keeping the wrapper
 * untyped sidesteps that without changing runtime behavior.
 */
function createFilteredServer(
  server: McpServer,
  allowed: Set<string>,
  seen: Set<string>,
  registered: string[]
): McpServer {
  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        return (name: string, ...rest: unknown[]) => {
          seen.add(name);
          if (!allowed.has(name)) {
            return undefined; // tool gated out — skip registration
          }
          registered.push(name);
          return target.registerTool(name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  };
  return new Proxy(server as any, handler) as McpServer;
}

export function registerTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager,
  smtpService: SmtpService,
  spamService: SpamService
): void {
  const enabled = resolveEnabledTools();

  // When `enabled` is null no restriction is configured, so the registrars get
  // the raw server and every tool is registered (original behavior). Otherwise
  // they get a filtering wrapper that drops tools outside the allowlist.
  const seen = new Set<string>();
  const registered: string[] = [];
  const target = enabled
    ? createFilteredServer(server, enabled, seen, registered)
    : server;

  // Register account management tools
  accountTools(target, accountManager, imapService, smtpService);

  // Register email operation tools
  emailTools(target, imapService, accountManager, smtpService);

  // Register folder operation tools
  folderTools(target, imapService, accountManager);

  // Register spam detection and management tools
  spamTools(target, imapService, spamService);

  if (enabled) {
    // Log to stderr only — stdout is the JSON-RPC channel.
    const skipped = seen.size - registered.length;
    console.error(
      `[imap-mcp] Tool access restricted: ${registered.length} enabled, ${skipped} disabled.`
    );
    const unknown = [...enabled].filter(name => !seen.has(name));
    if (unknown.length > 0) {
      console.error(
        `[imap-mcp] Warning: ignoring unknown tool name(s) in IMAP_MCP_ENABLED_TOOLS: ${unknown.join(', ')}`
      );
    }
  }
}

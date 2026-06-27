import { describe, it, expect, afterEach } from 'vitest';
import {
  registerTools,
  resolveEnabledTools,
  READ_ONLY_TOOLS,
} from '../src/tools/index.js';

// Tool names that must NEVER appear in the read-only subset (they mutate
// mailboxes, send mail, or change stored config).
const DESTRUCTIVE_TOOLS = [
  'imap_delete_email',
  'imap_bulk_delete',
  'imap_bulk_delete_by_search',
  'imap_send_email',
  'imap_reply_to_email',
  'imap_forward_email',
  'imap_move_email',
  'imap_mark_as_read',
  'imap_mark_as_unread',
  'imap_remove_account',
  'imap_add_account',
  'imap_update_account',
  'imap_create_folder',
  'imap_delete_spam',
  'imap_delete_by_domain',
  'imap_add_spam_domain',
];

/** Collect the tool names that `registerTools` actually registers under the given env. */
function registeredToolsFor(env: Record<string, string | undefined>): string[] {
  const saved: Record<string, string | undefined> = {};
  for (const key of ['IMAP_MCP_ENABLED_TOOLS', 'IMAP_MCP_READ_ONLY']) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }

  const names: string[] = [];
  const fakeServer = { registerTool: (name: string) => names.push(name) };
  const stub: any = {};
  try {
    registerTools(fakeServer as any, stub, stub, stub, stub);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
  return names;
}

describe('resolveEnabledTools', () => {
  it('returns null (all tools) when nothing is configured', () => {
    expect(resolveEnabledTools({})).toBeNull();
  });

  it('returns the read-only subset when IMAP_MCP_READ_ONLY is truthy', () => {
    const set = resolveEnabledTools({ IMAP_MCP_READ_ONLY: 'true' });
    expect(set).toEqual(new Set(READ_ONLY_TOOLS));
  });

  it.each(['1', 'true', 'YES', 'On'])(
    'treats %s as enabling read-only mode',
    (value) => {
      expect(resolveEnabledTools({ IMAP_MCP_READ_ONLY: value })).not.toBeNull();
    }
  );

  it.each(['0', 'false', 'no', ''])(
    'treats %s as NOT enabling read-only mode',
    (value) => {
      expect(resolveEnabledTools({ IMAP_MCP_READ_ONLY: value })).toBeNull();
    }
  );

  it('returns the explicit allowlist from IMAP_MCP_ENABLED_TOOLS', () => {
    const set = resolveEnabledTools({
      IMAP_MCP_ENABLED_TOOLS: 'imap_search_emails, imap_get_email',
    });
    expect(set).toEqual(new Set(['imap_search_emails', 'imap_get_email']));
  });

  it('normalizes names without the imap_ prefix and mixed casing', () => {
    const set = resolveEnabledTools({
      IMAP_MCP_ENABLED_TOOLS: 'search_emails, IMAP_GET_EMAIL',
    });
    expect(set).toEqual(new Set(['imap_search_emails', 'imap_get_email']));
  });

  it('ignores empty entries and surrounding whitespace', () => {
    const set = resolveEnabledTools({
      IMAP_MCP_ENABLED_TOOLS: '  imap_list_folders ,, , imap_folder_status ',
    });
    expect(set).toEqual(new Set(['imap_list_folders', 'imap_folder_status']));
  });

  it('gives IMAP_MCP_ENABLED_TOOLS precedence over IMAP_MCP_READ_ONLY', () => {
    const set = resolveEnabledTools({
      IMAP_MCP_ENABLED_TOOLS: 'imap_send_email',
      IMAP_MCP_READ_ONLY: 'true',
    });
    expect(set).toEqual(new Set(['imap_send_email']));
  });

  it('falls back to read-only when the explicit list is blank', () => {
    const set = resolveEnabledTools({
      IMAP_MCP_ENABLED_TOOLS: '  ,, ',
      IMAP_MCP_READ_ONLY: 'true',
    });
    expect(set).toEqual(new Set(READ_ONLY_TOOLS));
  });
});

describe('READ_ONLY_TOOLS subset', () => {
  it('includes core read tools', () => {
    expect(READ_ONLY_TOOLS).toContain('imap_search_emails');
    expect(READ_ONLY_TOOLS).toContain('imap_get_email');
    expect(READ_ONLY_TOOLS).toContain('imap_list_folders');
  });

  it('excludes every destructive / mutating tool', () => {
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(READ_ONLY_TOOLS).not.toContain(tool);
    }
  });
});

describe('registerTools gating', () => {
  afterEach(() => {
    delete process.env.IMAP_MCP_ENABLED_TOOLS;
    delete process.env.IMAP_MCP_READ_ONLY;
  });

  it('registers ALL tools when unrestricted', () => {
    const names = registeredToolsFor({});
    // Sanity: the full surface is large and includes destructive tools.
    expect(names.length).toBeGreaterThan(READ_ONLY_TOOLS.length);
    expect(names).toContain('imap_delete_email');
    expect(names).toContain('imap_send_email');
  });

  it('registers only the read-only subset in read-only mode', () => {
    const names = registeredToolsFor({ IMAP_MCP_READ_ONLY: 'true' });
    expect(new Set(names)).toEqual(new Set(READ_ONLY_TOOLS));
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it('registers only the explicit allowlist', () => {
    const names = registeredToolsFor({
      IMAP_MCP_ENABLED_TOOLS: 'imap_search_emails,imap_get_email',
    });
    expect(new Set(names)).toEqual(
      new Set(['imap_search_emails', 'imap_get_email'])
    );
  });

  it('silently ignores unknown tool names in the allowlist', () => {
    const names = registeredToolsFor({
      IMAP_MCP_ENABLED_TOOLS: 'imap_search_emails,imap_does_not_exist',
    });
    expect(names).toEqual(['imap_search_emails']);
  });
});

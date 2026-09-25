import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Regression guard: `imap-setup` used to derive the MCP server path from
// process.cwd(), so running the globally installed binary from any other
// directory wrote a bogus "<cwd>/dist/index.js" into claude_desktop_config.json.
// Claude Desktop then failed to spawn it and reported only "Connection closed".
// The path must come from the module's own location instead.
const SETUP_SRC = readFileSync(join(process.cwd(), 'src', 'setup.ts'), 'utf-8');

describe('setup: Claude Desktop config generation', () => {
  it('derives the server path from the module location, not the cwd', () => {
    expect(SETUP_SRC).toContain('fileURLToPath(import.meta.url)');
    expect(SETUP_SRC).not.toMatch(/process\.cwd\(\)[^)]*['"]dist['"]/);
  });

  it('does not write a bare "node" command', () => {
    // GUI apps on macOS do not inherit the shell PATH, so a bare `node` is
    // frequently unresolvable even when it works in the user's terminal.
    expect(SETUP_SRC).toContain('command: process.execPath');
    expect(SETUP_SRC).not.toMatch(/command:\s*['"]node['"]/);
  });
});

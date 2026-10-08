/**
 * The package version as published, for the MCP `serverInfo` handshake and the
 * setup wizard's health endpoint.
 *
 * Both used to hard-code `1.0.0`, so every release identified itself as 1.0.0
 * to clients and directories that record the handshake.
 *
 * The version is read from `package.json` at runtime instead of being inlined.
 * The file sits at a different depth depending on how the code runs — `src/`
 * and `src/web/` under tsx, `dist/` and `dist/web/` after the esbuild bundle —
 * so we walk up from this module until we find our own `package.json`. npm
 * always ships `package.json`, so this works for npx and global installs too.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_NAME = 'imap-mcp-server';

export function findPackageVersion(startDir: string): string {
  let dir = startDir;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // No (readable) package.json here — keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

export const PACKAGE_VERSION = findPackageVersion(dirname(fileURLToPath(import.meta.url)));

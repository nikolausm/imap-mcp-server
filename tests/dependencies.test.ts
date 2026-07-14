import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Regression guard for #108: `string-width` 8.x uses the regex `v` flag, which
// throws "Invalid regular expression flags" on Node <20. AGENTS.md promises
// Node >=18 support, so any transitive upgrade to 8.x silently breaks the
// `imap-setup` entrypoint for older Node installs. Pin via npm `overrides` and
// assert no copy of 8.x ships under node_modules.

const ROOT = join(process.cwd(), 'node_modules');
const SEMVER_8X = /^8\./;

const collectStringWidthDirs = (dir: string, acc: string[] = []): string[] => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (entry === 'string-width') {
        acc.push(full);
      } else if (entry !== '.bin' && entry !== '.cache') {
        collectStringWidthDirs(full, acc);
      }
    }
  }
  return acc;
};

describe('dependency pin: string-width <8 (Node 18 compat, #108)', () => {
  it('no transitive copy of string-width@8.x is installed', () => {
    const dirs = collectStringWidthDirs(ROOT);
    expect(dirs.length).toBeGreaterThan(0); // sanity: package is present
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      expect(
        SEMVER_8X.test(pkg.version),
        `${dir} is string-width@${pkg.version} (8.x uses the /v regex flag and breaks Node <20)`,
      ).toBe(false);
    }
  });

  it('package.json declares the override so future installs stay on 7.x', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.overrides?.['string-width']).toMatch(/^[~^]?7/);
  });
});
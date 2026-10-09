import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findPackageVersion, PACKAGE_VERSION } from '../src/utils/version.js';

const PKG = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));

describe('package version', () => {
  it('reports the version from package.json, not a hard-coded one', () => {
    expect(PACKAGE_VERSION).toBe(PKG.version);
  });

  it('walks past unrelated package.json files to our own', () => {
    const root = mkdtempSync(join(tmpdir(), 'imap-mcp-version-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'imap-mcp-server', version: '9.8.7' }));
    const nested = join(root, 'dist', 'web');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'dist', 'package.json'), JSON.stringify({ type: 'module' }));
    expect(findPackageVersion(nested)).toBe('9.8.7');
  });

  it('no longer hard-codes 1.0.0 in the handshake or the health endpoint', () => {
    for (const file of ['src/index.ts', 'src/web/server.ts']) {
      expect(readFileSync(join(process.cwd(), file), 'utf-8')).not.toContain("version: '1.0.0'");
    }
  });
});

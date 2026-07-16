import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp, statSync } from 'fs';
import path from 'path';
import os from 'os';

// Real filesystem test (no fs mock): the credential store holds the raw AES key
// and the encrypted accounts, so both — and their directory — must be readable
// only by the owner. POSIX-only; Windows has no comparable mode bits.
const runOnPosix = process.platform === 'win32' ? describe.skip : describe;

runOnPosix('AccountManager credential-store permissions', () => {
  let tmpHome: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    prevHome = process.env.HOME;
    tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'imap-mcp-perms-'));
    // AccountManager derives ~/.imap-mcp from os.homedir(), which honours $HOME.
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await fsp.rm(tmpHome, { recursive: true, force: true });
  });

  it('writes .key, accounts.json and their directory owner-only', async () => {
    const { AccountManager } = await import('../src/services/account-manager.js');
    const manager = new AccountManager();

    await manager.addAccount({
      name: 'Test',
      host: 'imap.test.com',
      port: 993,
      user: 'user@test.com',
      password: 'topsecret',
      tls: true,
    });

    const dir = path.join(tmpHome, '.imap-mcp');
    const mode = (p: string) => statSync(p).mode & 0o777;

    expect(mode(path.join(dir, '.key'))).toBe(0o600);
    expect(mode(path.join(dir, 'accounts.json'))).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });
});

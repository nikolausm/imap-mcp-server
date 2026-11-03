import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { encryptAesCbcLegacy } from '../src/credentials/crypto.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      chmod: vi.fn(),
    },
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

import { AccountManager } from '../src/services/account-manager.js';
import { promises as fs, readFileSync, writeFileSync, renameSync } from 'fs';

describe('AccountManager CBC → GCM migration', () => {
  const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('.key')) return keyHex;
      if (s.endsWith('accounts.json')) {
        const legacyPw = encryptAesCbcLegacy('legacy-pass', keyHex);
        return JSON.stringify([
          {
            id: 'acc-1',
            name: 'Legacy',
            host: 'imap.test.com',
            port: 993,
            user: 'u',
            password: legacyPw,
            tls: true,
          },
        ]);
      }
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
    });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.chmod).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.IMAP_MCP_MIGRATE_CREDENTIALS;
  });

  it('migrates legacy CBC fields to gcm:v1 and rewrites store', async () => {
    const manager = new AccountManager();
    const before = manager.getAccount('acc-1');
    expect(before?.password).toBe('legacy-pass');

    const result = await manager.migrateLegacyCiphertext();
    expect(result.migratedFields).toBe(1);

    expect(fs.writeFile).toHaveBeenCalled();
    const writeArgs = vi.mocked(fs.writeFile).mock.calls.map((c) => c[1]).filter((x) => typeof x === 'string');
    // atomic path uses writeFile then rename; find accounts payload
    const payload = writeArgs.find((s) => String(s).includes('gcm:v1:'));
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(String(payload));
    expect(parsed[0].password.startsWith('gcm:v1:')).toBe(true);
    expect(manager.getAccount('acc-1')?.password).toBe('legacy-pass');
  });
});

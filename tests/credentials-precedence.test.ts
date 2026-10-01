import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptAesGcm, fieldAad } from '../src/credentials/crypto.js';
import crypto from 'crypto';

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
import { promises as fs, readFileSync } from 'fs';
import { __setKeyringEntryCtorForTests, accountSecretName } from '../src/credentials/keyring.js';

describe('credential resolution precedence', () => {
  const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const key = Buffer.from(keyHex, 'hex');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IMAP_MCP_TEST_KEYRING = '1';
    const filePw = encryptAesGcm('file-pass', key, fieldAad('acc-1', 'password'));
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('.key')) return keyHex;
      if (s.endsWith('accounts.json')) {
        return JSON.stringify([
          {
            id: 'acc-1',
            name: 'Work Gmail',
            host: 'imap.test.com',
            port: 993,
            user: 'file-user',
            password: filePw,
            tls: true,
            credentialSource: 'keyring',
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
    __setKeyringEntryCtorForTests(undefined);
    delete process.env.IMAP_MCP_TEST_KEYRING;
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('IMAP_MCP_ACCOUNT_')) delete process.env[k];
    }
  });

  it('env overrides beat keyring and file', async () => {
    process.env.IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD = 'env-pass';
    const mem = new Map<string, string>();
    class FakeEntry {
      constructor(private service: string, private name: string) {}
      getPassword() {
        const v = mem.get(`${this.service}|${this.name}`);
        if (v === undefined) throw new Error('missing');
        return v;
      }
      setPassword(v: string) { mem.set(`${this.service}|${this.name}`, v); }
      deletePassword() { mem.delete(`${this.service}|${this.name}`); }
    }
    __setKeyringEntryCtorForTests(FakeEntry as any);
    mem.set(`imap-mcp|${accountSecretName('acc-1', 'imap-password')}`, 'keyring-pass');

    const manager = new AccountManager();
    await manager.hydrateExternalCredentials();
    expect(manager.getAccount('acc-1')?.password).toBe('env-pass');
  });

  it('keyring beats file when env absent', async () => {
    const mem = new Map<string, string>();
    class FakeEntry {
      constructor(private service: string, private name: string) {}
      getPassword() {
        const v = mem.get(`${this.service}|${this.name}`);
        if (v === undefined) throw new Error('missing');
        return v;
      }
      setPassword(v: string) { mem.set(`${this.service}|${this.name}`, v); }
      deletePassword() { mem.delete(`${this.service}|${this.name}`); }
    }
    __setKeyringEntryCtorForTests(FakeEntry as any);
    mem.set(`imap-mcp|${accountSecretName('acc-1', 'imap-password')}`, 'keyring-pass');

    const manager = new AccountManager();
    await manager.hydrateExternalCredentials();
    expect(manager.getAccount('acc-1')?.password).toBe('keyring-pass');
  });

  it('does not ambiently reroute when VAULT_ADDR/path set without credentialSource=vault', async () => {
    process.env.VAULT_ADDR = 'https://vault.example:8200';
    process.env.VAULT_TOKEN = 'tok';
    process.env.IMAP_MCP_VAULT_PATH = 'secret/imap-mcp';
    // No credentialSource/vaultPath on account → file password wins
    const manager = new AccountManager();
    await manager.hydrateExternalCredentials();
    expect(manager.getAccount('acc-1')?.password).toBe('file-pass');
    delete process.env.VAULT_ADDR;
    delete process.env.VAULT_TOKEN;
    delete process.env.IMAP_MCP_VAULT_PATH;
  });

  it('preserves keyring secret across rename', async () => {
    const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const key = Buffer.from(keyHex, 'hex');
    const filePw = encryptAesGcm('file-pass', key, fieldAad('acc-1', 'password'));
    let accountsJson = JSON.stringify([
      {
        id: 'acc-1',
        name: 'Work Gmail',
        host: 'imap.test.com',
        port: 993,
        user: 'file-user',
        password: filePw,
        tls: true,
        credentialSource: 'keyring',
      },
    ]);

    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('.key')) return keyHex;
      if (s.endsWith('accounts.json')) return accountsJson;
      throw Object.assign(new Error('enoent'), { code: 'ENOENT' });
    });
    vi.mocked(fs.writeFile).mockImplementation(async (p: any, data: any) => {
      if (String(p).endsWith('accounts.json')) {
        accountsJson = String(data);
      }
    });

    const mem = new Map<string, string>();
    class FakeEntry {
      constructor(private service: string, private name: string) {}
      getPassword() {
        const v = mem.get(`${this.service}|${this.name}`);
        if (v === undefined) throw new Error('missing');
        return v;
      }
      setPassword(v: string) { mem.set(`${this.service}|${this.name}`, v); }
      deletePassword() { mem.delete(`${this.service}|${this.name}`); }
    }
    __setKeyringEntryCtorForTests(FakeEntry as any);
    mem.set(`imap-mcp|${accountSecretName('acc-1', 'imap-password')}`, 'keyring-pass');

    const manager = new AccountManager();
    await manager.hydrateExternalCredentials();
    expect(manager.getAccount('acc-1')?.password).toBe('keyring-pass');

    await manager.updateAccount('acc-1', { name: 'Renamed Mail' });
    expect(manager.getAccount('acc-1')?.name).toBe('Renamed Mail');
    expect(manager.getAccount('acc-1')?.password).toBe('keyring-pass');
  });
});

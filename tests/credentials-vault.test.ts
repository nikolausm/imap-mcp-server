import { describe, it, expect, afterEach } from 'vitest';
import {
  captureAndScrubVaultAuthEnv,
  loadVaultConfigFromEnv,
  toKvV2DataPath,
} from '../src/credentials/vault.js';

describe('credentials/vault', () => {
  afterEach(() => {
    for (const k of [
      'VAULT_ADDR', 'BAO_ADDR', 'VAULT_TOKEN', 'BAO_TOKEN',
      'VAULT_ROLE_ID', 'BAO_ROLE_ID', 'VAULT_SECRET_ID', 'BAO_SECRET_ID',
      'VAULT_SKIP_VERIFY', 'BAO_SKIP_VERIFY', 'IMAP_MCP_VAULT_PATH',
    ]) {
      delete process.env[k];
    }
  });

  it('normalizes mount/path to KV v2 data path', () => {
    expect(toKvV2DataPath('secret/imap-mcp')).toBe('secret/data/imap-mcp');
    expect(toKvV2DataPath('secret/data/imap-mcp')).toBe('secret/data/imap-mcp');
    expect(toKvV2DataPath('kv_internal/ci/token')).toBe('kv_internal/data/ci/token');
  });

  it('rejects unsafe paths', () => {
    expect(() => toKvV2DataPath('../etc/passwd')).toThrow(/Unsafe/);
    expect(() => toKvV2DataPath('secret')).toThrow(/mount\/path/);
  });

  it('loads config from BAO_* and scrubs auth env', () => {
    process.env.BAO_ADDR = 'https://bao.example:8200';
    process.env.BAO_TOKEN = 'test-token';
    process.env.IMAP_MCP_VAULT_PATH = 'secret/imap-mcp';
    const store = captureAndScrubVaultAuthEnv();
    expect(process.env.BAO_TOKEN).toBeUndefined();
    expect(store.get('BAO_TOKEN')).toBe('test-token');
    const cfg = loadVaultConfigFromEnv(store);
    expect(cfg?.addr).toBe('https://bao.example:8200');
    expect(cfg?.token).toBe('test-token');
    expect(cfg?.path).toBe('secret/imap-mcp');
    expect(cfg?.skipVerify).toBe(false);
  });

  it('returns null when addr set without auth', () => {
    process.env.VAULT_ADDR = 'https://vault.example:8200';
    expect(loadVaultConfigFromEnv()).toBeNull();
  });
});

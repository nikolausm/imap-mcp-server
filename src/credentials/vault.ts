/**
 * Minimal Vault / OpenBao KV v2 reader for a public npm package.
 * Pattern mirrors itops ci/vault-fetch.sh at a high level (addr + token/AppRole,
 * TLS verify by default, mount/path → mount/data/path) without host-specific
 * TPM / snowcrash-secret bootstrap.
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import { URL } from 'url';

export interface VaultEnvConfig {
  addr: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  cacert?: string;
  skipVerify: boolean;
  /** Default KV mount/path prefix for account secrets, e.g. `secret/imap-mcp`. */
  path?: string;
}

const AUTH_ENV_KEYS = [
  'VAULT_TOKEN',
  'BAO_TOKEN',
  'VAULT_ROLE_ID',
  'BAO_ROLE_ID',
  'VAULT_SECRET_ID',
  'BAO_SECRET_ID',
] as const;

export function captureAndScrubVaultAuthEnv(
  store: Map<string, string> = new Map(),
): Map<string, string> {
  for (const key of AUTH_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      store.set(key, value);
      delete process.env[key];
    }
  }
  return store;
}

export function loadVaultConfigFromEnv(
  authStore?: Map<string, string>,
): VaultEnvConfig | null {
  const addr = process.env.BAO_ADDR || process.env.VAULT_ADDR;
  if (!addr) return null;

  const get = (k: string) => authStore?.get(k) ?? process.env[k];
  const token = get('BAO_TOKEN') || get('VAULT_TOKEN');
  const roleId = get('BAO_ROLE_ID') || get('VAULT_ROLE_ID');
  const secretId = get('BAO_SECRET_ID') || get('VAULT_SECRET_ID');
  const cacert = process.env.BAO_CACERT || process.env.VAULT_CACERT;
  const skipRaw = process.env.BAO_SKIP_VERIFY || process.env.VAULT_SKIP_VERIFY || '0';
  if (skipRaw !== '0' && skipRaw !== '1') {
    throw new Error('VAULT_SKIP_VERIFY / BAO_SKIP_VERIFY must be 0 or 1');
  }
  const skipVerify = skipRaw === '1';
  const path = process.env.IMAP_MCP_VAULT_PATH;

  if (!token && !(roleId && secretId)) {
    return null;
  }

  return { addr: addr.replace(/\/$/, ''), token, roleId, secretId, cacert, skipVerify, path };
}

/** Normalize `mount/path` or `mount/data/path` into the KV v2 data API path. */
export function toKvV2DataPath(mountAndPath: string): string {
  const cleaned = mountAndPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('//')) {
    throw new Error('Unsafe vault path');
  }
  const parts = cleaned.split('/');
  if (parts.length < 2) {
    throw new Error('Vault path must be mount/path');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0])) {
    throw new Error('Unsafe vault mount');
  }
  const mount = parts[0];
  const rest = parts.slice(1);
  if (rest[0] === 'data') {
    return `${mount}/data/${rest.slice(1).join('/')}`;
  }
  return `${mount}/data/${rest.join('/')}`;
}

function tlsOptions(cfg: VaultEnvConfig): https.RequestOptions {
  if (cfg.skipVerify) {
    return { rejectUnauthorized: false };
  }
  if (cfg.cacert) {
    return { ca: fs.readFileSync(cfg.cacert), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

async function vaultRequest(
  cfg: VaultEnvConfig,
  method: string,
  apiPath: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: any }> {
  const url = new URL(`${cfg.addr}/v1/${apiPath.replace(/^\/+/, '')}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const headers: Record<string, string> = {};
  if (token) headers['X-Vault-Token'] = token;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }

  const options: https.RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    ...(isHttps ? tlsOptions(cfg) : {}),
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = {};
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginAppRole(cfg: VaultEnvConfig): Promise<string> {
  const res = await vaultRequest(cfg, 'POST', 'auth/approle/login', {
    role_id: cfg.roleId,
    secret_id: cfg.secretId,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Vault AppRole login failed (HTTP ${res.status})`);
  }
  const token = res.json?.auth?.client_token;
  if (!token || typeof token !== 'string') {
    throw new Error('Vault AppRole login returned no client_token');
  }
  return token;
}

export async function resolveVaultToken(cfg: VaultEnvConfig): Promise<string> {
  if (cfg.token) return cfg.token;
  return loginAppRole(cfg);
}

export async function readVaultKvField(
  cfg: VaultEnvConfig,
  mountAndPath: string,
  field: string,
): Promise<string | undefined> {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {
    throw new Error('Unsafe vault field name');
  }
  const dataPath = toKvV2DataPath(mountAndPath);
  const token = await resolveVaultToken(cfg);
  const res = await vaultRequest(cfg, 'GET', dataPath, undefined, token);
  if (res.status === 404) return undefined;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Vault KV read failed (HTTP ${res.status})`);
  }
  const value = res.json?.data?.data?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Vault field ${field} is not a string`);
  }
  return value;
}

export async function tryRevokeToken(cfg: VaultEnvConfig, token: string): Promise<void> {
  try {
    await vaultRequest(cfg, 'POST', 'auth/token/revoke-self', undefined, token);
  } catch {
    // ignore
  }
}

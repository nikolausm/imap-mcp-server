import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebUIServer } from '../src/web/server.js';

// Reproduces the gap Bjoern reported after the first fix: GET routes were
// scrubbed, but POST/PUT still returned account objects with plaintext
// passwords, and the API had no loopback/cross-origin guard.

const IMAP_SECRET = 'imap-plaintext-secret';
const SMTP_SECRET = 'smtp-plaintext-secret';

const decryptedAccount = (over: Record<string, any> = {}) => ({
  id: 'a1',
  name: 'Work',
  host: 'imap.example.com',
  port: 993,
  user: 'user@example.com',
  password: IMAP_SECRET,
  tls: true,
  smtp: { host: 'smtp.example.com', port: 587, secure: false, password: SMTP_SECRET },
  ...over,
});

const fakeAccountManager = {
  getAllAccounts: () => [decryptedAccount()],
  getAccount: (id: string) => (id === 'a1' ? decryptedAccount() : undefined),
  // Mirrors the real AccountManager: returns a DECRYPTED account.
  updateAccount: async (_id: string, updates: Record<string, any>) => ({ ...decryptedAccount(), ...updates }),
  // Mirrors the real AccountManager: echoes the plaintext password back.
  addAccount: async (acct: Record<string, any>) => ({ ...acct, id: 'new' }),
};

let httpServer: Server;
let port: number;

function request(opts: { method?: string; path: string; headers?: Record<string, string>; body?: any }) {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(data));
  }
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: chunks }));
      },
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  const wizard = new WebUIServer(0, { accountManager: fakeAccountManager as any, imapService: {} as any });
  await new Promise<void>((resolve) => {
    httpServer = wizard.getApp().listen(0, () => resolve());
  });
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(() => {
  httpServer?.close();
});

describe('Web wizard — credential exposure on POST/PUT (Bjoern follow-up)', () => {
  it('PUT /api/accounts/:id no-op rename does not leak stored passwords', async () => {
    const res = await request({ method: 'PUT', path: '/api/accounts/a1', body: { name: 'Renamed' } });
    expect(res.status).toBe(200);
    // The caller supplied no password yet must not get either back.
    expect(res.text).not.toContain(IMAP_SECRET);
    expect(res.text).not.toContain(SMTP_SECRET);
    const body = JSON.parse(res.text);
    expect(body.account.password).toBeUndefined();
    expect(body.account.smtp?.password).toBeUndefined();
    expect(body.account.name).toBe('Renamed');
  });

  it('POST /api/accounts does not echo the plaintext password back', async () => {
    const res = await request({
      method: 'POST',
      path: '/api/accounts',
      body: { name: 'New', host: 'imap.example.com', port: 993, imapUsername: 'u@example.com', password: 'brand-new-pw' },
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('brand-new-pw');
    const body = JSON.parse(res.text);
    expect(body.account.password).toBeUndefined();
  });
});

describe('Web wizard — loopback / cross-origin guard', () => {
  it('rejects a cross-origin request (non-loopback Origin)', async () => {
    const res = await request({ path: '/api/accounts', headers: { Origin: 'http://evil.com' } });
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(IMAP_SECRET);
  });

  it('rejects a non-loopback Host header (DNS rebinding)', async () => {
    const res = await request({ path: '/api/accounts', headers: { Host: 'evil.com' } });
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(IMAP_SECRET);
  });

  it('allows a same-origin loopback request', async () => {
    const res = await request({ path: '/api/accounts', headers: { Origin: `http://localhost:${port}` } });
    expect(res.status).toBe(200);
  });
});

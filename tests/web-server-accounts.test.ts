import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebUIServer } from '../src/web/server.js';

// getAllAccounts() returns DECRYPTED credentials by design (the manager's job).
// The wizard's HTTP API is unauthenticated and CORS-open, so the API layer must
// never let those credentials cross the wire. Inject a fake manager holding
// obvious secrets and assert the /api/accounts response is scrubbed.
const SECRET = 'imap-plaintext-secret';
const SMTP_SECRET = 'smtp-plaintext-secret';

const fakeAccountManager = {
  getAllAccounts: () => [
    {
      id: 'a1',
      name: 'Work',
      host: 'imap.example.com',
      port: 993,
      user: 'user@example.com',
      password: SECRET,
      tls: true,
      smtp: { host: 'smtp.example.com', port: 587, secure: false, password: SMTP_SECRET },
    },
  ],
  getAccount: (id: string) =>
    id === 'a1'
      ? {
          id: 'a1',
          name: 'Work',
          host: 'imap.example.com',
          port: 993,
          user: 'user@example.com',
          password: SECRET,
          tls: true,
          smtp: { host: 'smtp.example.com', port: 587, secure: false, password: SMTP_SECRET },
        }
      : undefined,
};

let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  const wizard = new WebUIServer(0, {
    accountManager: fakeAccountManager as any,
    imapService: {} as any,
  });
  await new Promise<void>((resolve) => {
    httpServer = wizard.getApp().listen(0, () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  httpServer?.close();
});

describe('Web wizard credential exposure', () => {
  it('GET /api/accounts never returns passwords', async () => {
    const res = await fetch(`${baseUrl}/api/accounts`);
    expect(res.ok).toBe(true);
    const raw = await res.text();

    // Belt: the plaintext secrets must not appear anywhere in the payload.
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(SMTP_SECRET);

    // Braces: the fields must be absent, and the rest of the account intact.
    const accounts = JSON.parse(raw);
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts[0].password).toBeUndefined();
    expect(accounts[0].smtp?.password).toBeUndefined();
    expect(accounts[0].user).toBe('user@example.com');
    expect(accounts[0].smtp?.host).toBe('smtp.example.com');
  });

  it('GET /api/accounts/:id also stays password-free', async () => {
    const res = await fetch(`${baseUrl}/api/accounts/a1`);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(SMTP_SECRET);
    const body = JSON.parse(raw);
    expect(body.account.password).toBeUndefined();
    expect(body.account.smtp?.password).toBeUndefined();
  });
});

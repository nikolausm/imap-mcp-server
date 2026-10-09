import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebUIServer } from '../src/web/server.js';

// The wizard binds to loopback by default. With --host / IMAP_MCP_BIND it can
// be reached from another machine; Host is then no longer a usable signal, so
// every request must carry an access token instead.

const TOKEN = 'test-token-0123456789';

const fakeAccountManager = {
  getAllAccounts: () => [{ id: 'a1', name: 'Work', host: 'imap.example.com', port: 993, user: 'u', password: 'secret', tls: true }],
};

function listen(wizard: WebUIServer): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = wizard.getApp().listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function request(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const deps = { accountManager: fakeAccountManager as any, imapService: {} as any };

describe('web wizard bind address', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds to 127.0.0.1 by default', async () => {
    const wizard = new WebUIServer(4321, deps);
    const listenSpy = vi.spyOn(wizard.getApp(), 'listen').mockImplementation(((...args: any[]) => {
      args[args.length - 1]();
      return { close: vi.fn() } as any;
    }) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await wizard.start(false);

    expect(listenSpy.mock.calls[0][0]).toBe(4321);
    expect(listenSpy.mock.calls[0][1]).toBe('127.0.0.1');
    expect(wizard.isRemote()).toBe(false);
    expect(wizard.getAccessUrl()).toBe('http://localhost:4321/');
  });

  it('takes the bind address from IMAP_MCP_BIND and generates a token', () => {
    vi.stubEnv('IMAP_MCP_BIND', '0.0.0.0');
    const wizard = new WebUIServer(4321, deps);

    expect(wizard.isRemote()).toBe(true);
    expect(wizard.getAccessUrl()).toMatch(/^http:\/\/.+:4321\/\?token=[A-Za-z0-9_-]{32}$/);
    expect(wizard.getAccessUrl(true)).toMatch(/^http:\/\/localhost:4321\/\?token=/);
  });

  it('does not echo a token supplied via IMAP_MCP_WIZARD_TOKEN', () => {
    vi.stubEnv('IMAP_MCP_WIZARD_TOKEN', TOKEN);
    const wizard = new WebUIServer(4321, { ...deps, bindHost: '192.168.1.5' });

    expect(wizard.getAccessUrl()).toBe('http://192.168.1.5:4321/');
  });

  it('treats ::1 and localhost as loopback', () => {
    expect(new WebUIServer(1, { ...deps, bindHost: '::1' }).isRemote()).toBe(false);
    expect(new WebUIServer(1, { ...deps, bindHost: 'localhost' }).isRemote()).toBe(false);
  });
});

describe('web wizard in loopback mode', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    ({ server, port } = await listen(new WebUIServer(0, deps)));
  });
  afterAll(() => server?.close());

  it('still rejects a non-loopback Host', async () => {
    const res = await request(port, '/api/accounts', { Host: 'mail-server:3000' });
    expect(res.status).toBe(403);
  });

  it('serves loopback requests without a token', async () => {
    const res = await request(port, '/api/accounts', { Host: `localhost:${port}` });
    expect(res.status).toBe(200);
  });
});

describe('web wizard in remote mode', () => {
  let server: Server;
  let port: number;
  const host = 'mail-server:3000';

  beforeAll(async () => {
    ({ server, port } = await listen(new WebUIServer(0, { ...deps, bindHost: '0.0.0.0', accessToken: TOKEN })));
  });
  afterAll(() => server?.close());

  it('rejects API requests without a token', async () => {
    const res = await request(port, '/api/accounts', { Host: host });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error).toMatch(/token/);
  });

  it('rejects the page itself without a token', async () => {
    const res = await request(port, '/', { Host: host });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect((await request(port, '/?token=wrong', { Host: host })).status).toBe(401);
    expect((await request(port, '/api/accounts', { Host: host, Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await request(port, '/api/accounts', { Host: host, Cookie: 'imap_wizard_token=wrong' })).status).toBe(401);
  });

  it('exchanges ?token= for an HttpOnly SameSite=Strict cookie and drops it from the URL', async () => {
    const res = await request(port, `/?token=${TOKEN}`, { Host: host });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`imap_wizard_token=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('accepts the cookie on a non-loopback Host', async () => {
    const res = await request(port, '/api/accounts', { Host: host, Cookie: `other=1; imap_wizard_token=${TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('secret');
  });

  it('accepts a bearer token for scripted use', async () => {
    const res = await request(port, '/api/accounts', { Host: host, Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it('refuses cross-origin requests even with a valid token', async () => {
    const res = await request(port, '/api/accounts', {
      Host: host,
      Origin: 'http://evil.example',
      Cookie: `imap_wizard_token=${TOKEN}`,
    });
    expect(res.status).toBe(403);
  });

  it('allows same-origin requests from the wizard page', async () => {
    const res = await request(port, '/api/accounts', {
      Host: host,
      Origin: `http://${host}`,
      Cookie: `imap_wizard_token=${TOKEN}`,
    });
    expect(res.status).toBe(200);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebUIServer } from '../src/web/server.js';

// The wizard saves the picked provider card as the account's `provider`
// (registry id), and ignores anything that isn't a registry id.
const addAccount = vi.fn(async (acc: any) => ({ ...acc, id: 'new' }));
let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  const wizard = new WebUIServer(0, {
    accountManager: { addAccount, getAllAccounts: () => [], getAccount: () => undefined } as any,
    imapService: {} as any,
  });
  await new Promise<void>((resolve) => {
    httpServer = wizard.getApp().listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  httpServer?.close();
});

async function post(body: Record<string, unknown>) {
  addAccount.mockClear();
  const res = await fetch(`${baseUrl}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P', email: 'u@proton.me', password: 'pw', host: 'protonmail-bridge', port: 143, tls: false, ...body }),
  });
  expect(res.status).toBe(200);
  return addAccount.mock.calls[0][0];
}

describe('POST /api/accounts provider', () => {
  it('stores a registry provider id', async () => {
    expect(await post({ provider: 'protonmail' })).toMatchObject({ provider: 'protonmail' });
  });

  it.each(['custom', 'proton', 42])('drops a non-registry value (%s)', async (provider) => {
    expect(await post({ provider })).not.toHaveProperty('provider');
  });

  it('leaves provider unset when the wizard sends none', async () => {
    expect(await post({})).not.toHaveProperty('provider');
  });
});

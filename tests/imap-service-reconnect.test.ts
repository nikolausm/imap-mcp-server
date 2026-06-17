import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';
import { ImapAccount } from '../src/types/index.js';

// Every ImapFlow the service constructs is recorded here so a test can assert
// that a reconnect builds a FRESH instance instead of reusing a dead one.
const instances: any[] = [];

// A mock that mimics the one ImapFlow invariant that caused the production bug:
// an instance is single-use. Once it has connected, calling .connect() on the
// SAME object again rejects with "Can not re-use ImapFlow instance" (the real
// imapflow error). The service must therefore construct a new instance.
vi.mock('imapflow', () => {
  return {
    ImapFlow: class {
      usable = true;
      connectedOnce = false;
      connectMock = vi.fn().mockResolvedValue(undefined);
      logoutMock = vi.fn().mockResolvedValue(undefined);
      listMock = vi.fn().mockResolvedValue([
        { path: 'INBOX', delimiter: '/', flags: [] },
      ]);
      constructor() {
        instances.push(this);
      }
      connect() {
        if (this.connectedOnce) {
          return Promise.reject(new Error('Can not re-use ImapFlow instance'));
        }
        this.connectedOnce = true;
        return this.connectMock();
      }
      logout() { return this.logoutMock(); }
      list() { return this.listMock(); }
      on() { /* no-op */ }
    },
  };
});

describe('ImapService reconnect (ImapFlow instances are single-use)', () => {
  let imapService: ImapService;
  let account: ImapAccount;

  beforeEach(() => {
    instances.length = 0;
    imapService = new ImapService();
    account = {
      id: 'acc',
      name: 'Test',
      host: 'imap.test.com',
      port: 993,
      user: 'user@test.com',
      password: 'pw',
      tls: true,
    };
  });

  it('rebuilds a fresh ImapFlow when the live connection went stale', async () => {
    await imapService.connect(account);
    expect(instances).toHaveLength(1);

    // Simulate an idle-timeout drop between two tool calls: the client object is
    // still cached but no longer usable.
    instances[0].usable = false;

    // The next operation must transparently reconnect. With the old code this
    // called .connect() on the dead instance and threw
    // "Failed to reconnect: Can not re-use ImapFlow instance".
    const folders = await imapService.listFolders(account.id);

    expect(folders).toHaveLength(1);
    // A brand-new instance was constructed and used (not the dead one reused).
    expect(instances).toHaveLength(2);
    expect(instances[1].usable).toBe(true);
    expect(instances[1].connectedOnce).toBe(true);
  });

  it('does not throw the "Can not re-use ImapFlow instance" error on reconnect', async () => {
    await imapService.connect(account);
    instances[0].usable = false;

    await expect(imapService.listFolders(account.id)).resolves.toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';
import type { ImapAccount } from '../src/types/index.js';

// Records the options every ImapFlow is constructed with so we can assert on
// the TLS parameters the service hands to imapflow.
const constructorOptions: any[] = [];

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: any) {
      constructorOptions.push(options);
    }
    connect() {
      return Promise.resolve();
    }
    logout() {
      return Promise.resolve();
    }
    on() {}
  },
}));

describe('ImapService TLS host for local bridges', () => {
  let service: ImapService;

  const account = (host: string): ImapAccount => ({
    id: 'bridge',
    name: 'Bridge',
    host,
    port: 1143,
    user: 'user@example.com',
    password: 'secret',
    tls: false,
  });

  beforeEach(() => {
    constructorOptions.length = 0;
    service = new ImapService();
  });

  // A local bridge (e.g. ProtonMail Bridge) listens on 127.0.0.1 with a cert
  // bound to that IP and upgrades via STARTTLS. imapflow's upgrade path passes
  // no `host` to Node's TLS layer, so without an explicit tls.host Node checks
  // the cert against the default `localhost` and rejects the 127.0.0.1 cert.
  it('passes the account host to the TLS layer so cert validation targets 127.0.0.1', async () => {
    await service.connect(account('127.0.0.1'));

    expect(constructorOptions).toHaveLength(1);
    expect(constructorOptions[0].host).toBe('127.0.0.1');
    expect(constructorOptions[0].tls?.host).toBe('127.0.0.1');
  });
});

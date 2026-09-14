import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';
import type { ImapAccount } from '../src/types/index.js';

// Records the options every ImapFlow is constructed with so we can assert on
// the STARTTLS parameters the service hands to imapflow.
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

describe('ImapService opportunistic STARTTLS opt-out', () => {
  let service: ImapService;

  const account = (allowStartTLS?: boolean): ImapAccount => ({
    id: 'acct',
    name: 'Shared host',
    host: 'mail.example.com',
    port: 143,
    user: 'user@example.com',
    password: 'secret',
    tls: false,
    ...(allowStartTLS !== undefined ? { allowStartTLS } : {}),
  });

  beforeEach(() => {
    constructorOptions.length = 0;
    service = new ImapService();
  });

  // imapflow opportunistically upgrades a non-`secure` connection via STARTTLS
  // whenever the server advertises it, independent of `secure`/`tls`. That's
  // correct for a normal STARTTLS-on-submission-port setup, but some shared
  // mail hosts (e.g. DreamHost) advertise STARTTLS on a hostname covered only
  // by a shared wildcard cert that doesn't match, so the upgrade fails cert
  // validation even though the account was configured for a plain connection.
  it('defaults to leaving the opportunistic STARTTLS upgrade enabled', async () => {
    await service.connect(account());

    expect(constructorOptions).toHaveLength(1);
    expect(constructorOptions[0].doSTARTTLS).toBeUndefined();
  });

  it('passes doSTARTTLS: false to imapflow when allowStartTLS is false', async () => {
    await service.connect(account(false));

    expect(constructorOptions).toHaveLength(1);
    expect(constructorOptions[0].doSTARTTLS).toBe(false);
  });

  it('applies the same opt-out to testConnection', async () => {
    await service.testConnection(account(false));

    expect(constructorOptions).toHaveLength(1);
    expect(constructorOptions[0].doSTARTTLS).toBe(false);
  });
});

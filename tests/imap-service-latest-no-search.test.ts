import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';

// Minimal imapflow stand-in. `mailbox` mirrors what mailboxOpen() sets once a
// mailbox is selected — imapflow reports the message count as `exists`.
const makeClient = (overrides: Record<string, any> = {}) => {
  const messages = [
    { uid: 101, seq: 1, internalDate: new Date('2026-01-01'), flags: new Set(['\\Seen']), envelope: { subject: 'first', from: [], to: [] } },
    { uid: 102, seq: 2, internalDate: new Date('2026-01-02'), flags: new Set(), envelope: { subject: 'second', from: [], to: [] } },
    { uid: 103, seq: 3, internalDate: new Date('2026-01-03'), flags: new Set(), envelope: { subject: 'third', from: [], to: [] } },
  ];

  return {
    mailbox: { path: 'INBOX', exists: 3, uidNext: 104, uidValidity: 1n, flags: new Set() },
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    // A Strato-style server: SEARCH comes back empty even though EXISTS is 3.
    search: vi.fn(async () => []),
    fetch: vi.fn(function* () { yield* messages; }),
    ...overrides,
  };
};

const serviceWith = (client: any) => {
  const service = new ImapService({} as any);
  // ensureConnected is private; stub it so the test drives the fetch logic only.
  (service as any).ensureConnected = vi.fn(async () => client);
  return service;
};

describe('getLatestEmails without SEARCH (#138)', () => {
  beforeEach(() => vi.clearAllMocks());

  // The regression: every read path went through client.search({all:true}), so
  // a server whose SEARCH answers empty made the tool return nothing at all,
  // even with a non-zero message count.
  it('returns messages when SEARCH answers empty but EXISTS is non-zero', async () => {
    const client = makeClient();
    const messages = await serviceWith(client).getLatestEmails('acc1', 'INBOX', 10);

    expect(messages).toHaveLength(3);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('addresses the newest messages by sequence range, not by UID', async () => {
    const client = makeClient();
    await serviceWith(client).getLatestEmails('acc1', 'INBOX', 2);

    const [range, , options] = client.fetch.mock.calls[0];
    expect(range).toBe('2:3');
    expect(options?.uid).toBeFalsy();
  });

  it('clamps the range to 1 when the mailbox holds fewer messages than requested', async () => {
    const client = makeClient();
    await serviceWith(client).getLatestEmails('acc1', 'INBOX', 50);

    expect(client.fetch.mock.calls[0][0]).toBe('1:3');
  });

  it('returns an empty list for an empty mailbox without fetching', async () => {
    const client = makeClient({ mailbox: { path: 'INBOX', exists: 0 } });
    const messages = await serviceWith(client).getLatestEmails('acc1', 'INBOX', 10);

    expect(messages).toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  // Defensive: if the mailbox metadata is unavailable we still have the old path.
  it('falls back to SEARCH when the mailbox reports no EXISTS', async () => {
    const client = makeClient({
      mailbox: false,
      search: vi.fn(async () => [101, 102, 103]),
    });
    const messages = await serviceWith(client).getLatestEmails('acc1', 'INBOX', 2);

    expect(client.search).toHaveBeenCalled();
    const [uids, , options] = client.fetch.mock.calls[0];
    expect(uids).toEqual([102, 103]);
    expect(options?.uid).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('returns empty when the mailbox metadata is missing and SEARCH is also empty', async () => {
    const client = makeClient({ mailbox: false, search: vi.fn(async () => []) });
    expect(await serviceWith(client).getLatestEmails('acc1', 'INBOX', 10)).toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('still sorts the result newest first', async () => {
    const client = makeClient();
    const messages = await serviceWith(client).getLatestEmails('acc1', 'INBOX', 10);

    expect(messages.map(m => m.subject)).toEqual(['third', 'second', 'first']);
  });

  it('releases the mailbox lock', async () => {
    const release = vi.fn();
    const client = makeClient({ getMailboxLock: vi.fn(async () => ({ release })) });
    await serviceWith(client).getLatestEmails('acc1', 'INBOX', 10);

    expect(release).toHaveBeenCalled();
  });
});

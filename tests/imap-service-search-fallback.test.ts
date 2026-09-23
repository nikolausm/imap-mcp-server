import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService, CLIENT_SIDE_BODY_SEARCH_MAX, SEARCH_UNAVAILABLE_MESSAGE } from '../src/services/imap-service.js';
import { matchesSearchCriteria, extractMessageIds } from '../src/utils/client-side-search.js';

const raw = (headers: string, body: string) => Buffer.from(`${headers}\r\n\r\n${body}`);

const MESSAGES = [
  {
    uid: 101, seq: 1, internalDate: new Date('2026-01-01T10:00:00Z'), flags: new Set(['\\Seen']),
    envelope: { subject: 'Invoice January', messageId: '<a@x>', from: [{ name: 'Alice', address: 'alice@shop.example' }], to: [{ address: 'me@example.com' }] },
    headers: Buffer.from('In-Reply-To: <root@x>\r\n'),
    source: raw('Subject: Invoice January', 'Please pay the amount due.'),
  },
  {
    uid: 102, seq: 2, internalDate: new Date('2026-02-01T10:00:00Z'), flags: new Set(['\\Flagged']),
    envelope: { subject: 'Hello', messageId: '<b@x>', from: [{ name: 'Bob', address: 'bob@friends.example' }], to: [{ address: 'me@example.com' }] },
    headers: Buffer.from('References: <other@x> <root@x>\r\n'),
    source: raw('Subject: Hello', 'Just saying hi.'),
  },
  {
    uid: 103, seq: 3, internalDate: new Date('2026-03-01T10:00:00Z'), flags: new Set(),
    envelope: { subject: 'Invoice March', messageId: '<c@x>', from: [{ name: 'Alice', address: 'alice@shop.example' }], to: [{ address: 'me@example.com' }] },
    headers: Buffer.from(''),
    source: raw('Subject: Invoice March', 'Nothing to pay this month.'),
  },
];

// A Strato-style server (#138): EXISTS is right, FETCH works, every SEARCH is empty.
const makeClient = (overrides: Record<string, any> = {}) => ({
  mailbox: { path: 'INBOX', exists: MESSAGES.length },
  getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
  search: vi.fn(async () => []),
  fetch: vi.fn(function* (range: any) {
    yield* Array.isArray(range) ? MESSAGES.filter(m => range.includes(m.uid)) : MESSAGES;
  }),
  ...overrides,
});

const serviceWith = (client: any) => {
  const service = new ImapService({} as any);
  (service as any).ensureConnected = vi.fn(async () => client);
  return service;
};

describe('searchEmails on a server whose SEARCH is broken (#138)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to client-side filtering', async () => {
    const client = makeClient();
    const result = await serviceWith(client).searchEmails('acc', 'INBOX', { from: 'alice', since: new Date('2026-02-01') });

    expect(result.map(m => m.uid)).toEqual([103]);
  });

  it('returns everything for an empty criteria set', async () => {
    const result = await serviceWith(makeClient()).searchEmails('acc', 'INBOX', {});
    expect(result.map(m => m.uid)).toEqual([101, 102, 103]);
  });

  it('filters by body over the parsed source of the remaining candidates only', async () => {
    const client = makeClient();
    const result = await serviceWith(client).searchEmails('acc', 'INBOX', { subject: 'invoice', body: 'PAY THE' });

    expect(result.map(m => m.uid)).toEqual([101]);
    const sourceFetch = client.fetch.mock.calls.find(([, q]: any[]) => q.source);
    expect(sourceFetch[0]).toEqual([101, 103]);
  });

  it('refuses a body search over too many candidates', async () => {
    const client = makeClient({ mailbox: { exists: CLIENT_SIDE_BODY_SEARCH_MAX + 1 } });
    const many = Array.from({ length: CLIENT_SIDE_BODY_SEARCH_MAX + 1 }, (_, i) => ({ ...MESSAGES[0], uid: i + 1 }));
    client.fetch = vi.fn(function* () { yield* many; });

    await expect(serviceWith(client).searchEmails('acc', 'INBOX', { body: 'x' })).rejects.toThrow(/narrow the search/);
  });

  it('throws instead of falling back when the caller disables the fallback', async () => {
    const client = makeClient();
    await expect(
      serviceWith(client).searchEmails('acc', 'INBOX', { from: 'alice' }, { clientSideFallback: false }),
    ).rejects.toThrow(SEARCH_UNAVAILABLE_MESSAGE);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('does not fall back when SEARCH works and simply has no match', async () => {
    const client = makeClient({
      search: vi.fn(async (q: any) => (q.all ? [101, 102, 103] : [])),
    });
    const result = await serviceWith(client).searchEmails('acc', 'INBOX', { from: 'nobody' }, { clientSideFallback: false });

    expect(result).toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('does not fall back for a genuinely empty mailbox', async () => {
    const client = makeClient({ mailbox: { exists: 0 } });
    const result = await serviceWith(client).searchEmails('acc', 'INBOX', {}, { clientSideFallback: false });

    expect(result).toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('uses the server result directly when SEARCH returns UIDs', async () => {
    const client = makeClient({ search: vi.fn(async () => [102]) });
    const result = await serviceWith(client).searchEmails('acc', 'INBOX', { from: 'bob' });

    expect(result.map(m => m.uid)).toEqual([102]);
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('findThreadMessages on a server whose SEARCH is broken (#138)', () => {
  it('matches In-Reply-To and References client-side', async () => {
    const root = { uid: 1, envelope: { messageId: '<ROOT@x>' } };
    const client = makeClient({
      fetch: vi.fn(function* (range: any, query: any) {
        if (query.headers) { yield* MESSAGES; return; }
        if (range === '1:*' && query.envelope && !query.flags) { yield root; return; }
        yield* Array.isArray(range) ? [root].filter(m => range.includes(m.uid)) : [root];
      }),
    });

    const result = await serviceWith(client).findThreadMessages('acc', 'Sent', 'INBOX');
    expect(result.messageIds).toEqual(['<ROOT@x>']);
    expect(result.uids).toEqual([101, 102]);
  });

  it('ignores References when searchReferences is false', async () => {
    const root = { uid: 1, envelope: { messageId: '<root@x>' } };
    const client = makeClient({
      fetch: vi.fn(function* (_range: any, query: any) {
        yield* query.headers ? MESSAGES : [root];
      }),
    });

    const result = await serviceWith(client).findThreadMessages('acc', 'Sent', 'INBOX', { searchReferences: false });
    expect(result.uids).toEqual([101]);
  });
});

describe('matchesSearchCriteria', () => {
  const msg = MESSAGES[0];

  it('matches address and subject case-insensitively as substrings', () => {
    expect(matchesSearchCriteria(msg, { from: 'SHOP.example' })).toBe(true);
    expect(matchesSearchCriteria(msg, { from: 'Alice' })).toBe(true);
    expect(matchesSearchCriteria(msg, { to: 'me@' })).toBe(true);
    expect(matchesSearchCriteria(msg, { subject: 'invoice' })).toBe(true);
    expect(matchesSearchCriteria(msg, { subject: 'receipt' })).toBe(false);
  });

  it('compares since/before day-granular in UTC like IMAP SEARCH', () => {
    expect(matchesSearchCriteria(msg, { since: new Date('2026-01-01') })).toBe(true);
    expect(matchesSearchCriteria(msg, { since: new Date('2026-01-02') })).toBe(false);
    expect(matchesSearchCriteria(msg, { before: new Date('2026-01-01') })).toBe(false);
    expect(matchesSearchCriteria(msg, { before: new Date('2026-01-02') })).toBe(true);
  });

  it('evaluates system flags and keywords', () => {
    const tagged = { ...msg, flags: new Set(['\\Seen', 'Work']) };
    expect(matchesSearchCriteria(tagged, { seen: true, flagged: false })).toBe(true);
    expect(matchesSearchCriteria(tagged, { seen: false })).toBe(false);
    expect(matchesSearchCriteria(tagged, { keywords: ['home', 'work'] })).toBe(true);
    expect(matchesSearchCriteria(tagged, { keywords: ['home'] })).toBe(false);
    expect(matchesSearchCriteria(tagged, { unKeywords: ['Work'] })).toBe(false);
  });

  it('matches Message-ID with or without brackets', () => {
    expect(matchesSearchCriteria(msg, { messageId: 'a@x' })).toBe(true);
    expect(matchesSearchCriteria(msg, { messageId: '<A@X>' })).toBe(true);
    expect(matchesSearchCriteria(msg, { messageId: 'z@x' })).toBe(false);
  });

  it('extracts bracketed Message-IDs from a References header', () => {
    expect(extractMessageIds('<one@x>\n <Two@X>')).toEqual(['one@x', 'two@x']);
    expect(extractMessageIds(undefined)).toEqual([]);
  });
});

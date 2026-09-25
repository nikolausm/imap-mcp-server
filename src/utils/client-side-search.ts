import { SearchCriteria } from '../types/index.js';

/**
 * Client-side evaluation of `SearchCriteria` against a FETCHed message
 * (envelope + flags + internalDate). Used only when the server's SEARCH is
 * unusable — Strato answers every SEARCH with an empty set despite a non-empty
 * mailbox (#138) — so the semantics mirror IMAP SEARCH as closely as possible:
 *
 * - from / to / subject: case-insensitive substring match on the header value
 * - since / before: compared on the internal date, day-granular in UTC (the
 *   same date imapflow would have sent in `SINCE` / `BEFORE`)
 * - seen / flagged / answered / draft, keywords / unKeywords: flag membership
 * - messageId: substring match on the normalized Message-ID (callers verify
 *   exact equality afterwards, as with the server-side HEADER search)
 *
 * `body` is not evaluated here — it needs the message source and is handled
 * separately by the caller.
 */
export interface ClientSideSearchMessage {
  uid: number;
  internalDate?: Date | string;
  flags?: Set<string> | string[];
  envelope?: {
    date?: Date | string;
    subject?: string;
    messageId?: string;
    from?: Array<{ name?: string; address?: string }>;
    to?: Array<{ name?: string; address?: string }>;
  };
}

const includesCi = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const addressText = (addrs?: Array<{ name?: string; address?: string }>) =>
  (addrs || []).map(a => `${a.name || ''} <${a.address || ''}>`).join(', ');

const startOfUtcDay = (value: Date) =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const normalizeId = (id: string) =>
  id.trim().replace(/^<+/, '').replace(/>+$/, '').trim().toLowerCase();

export function matchesSearchCriteria(msg: ClientSideSearchMessage, criteria: SearchCriteria): boolean {
  const env = msg.envelope || {};
  const flags = new Set(Array.from(msg.flags || []).map(f => f.toLowerCase()));

  if (criteria.from && !includesCi(addressText(env.from), criteria.from)) return false;
  if (criteria.to && !includesCi(addressText(env.to), criteria.to)) return false;
  if (criteria.subject && !includesCi(env.subject || '', criteria.subject)) return false;

  if (criteria.since || criteria.before) {
    const raw = msg.internalDate || env.date;
    const time = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isFinite(time)) return false;
    if (criteria.since && time < startOfUtcDay(criteria.since)) return false;
    if (criteria.before && time >= startOfUtcDay(criteria.before)) return false;
  }

  const flagFilters: Array<[boolean | undefined, string]> = [
    [criteria.seen, '\\seen'],
    [criteria.flagged, '\\flagged'],
    [criteria.answered, '\\answered'],
    [criteria.draft, '\\draft'],
  ];
  for (const [wanted, flag] of flagFilters) {
    if (wanted !== undefined && flags.has(flag) !== wanted) return false;
  }

  if (criteria.keywords && criteria.keywords.length > 0
    && !criteria.keywords.some(k => flags.has(k.toLowerCase()))) return false;
  if (criteria.unKeywords && criteria.unKeywords.some(k => flags.has(k.toLowerCase()))) return false;

  if (criteria.messageId) {
    const target = normalizeId(criteria.messageId);
    if (!target || !normalizeId(env.messageId || '').includes(target)) return false;
  }

  return true;
}

/** Extract every `<…>` Message-ID token from an In-Reply-To / References header. */
export function extractMessageIds(header: string | undefined): string[] {
  if (!header) return [];
  return (header.match(/<[^<>]+>/g) || []).map(normalizeId).filter(Boolean);
}

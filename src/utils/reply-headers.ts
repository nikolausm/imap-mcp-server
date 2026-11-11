/**
 * Recipient and threading headers for imap_reply_to_email.
 *
 * Kept free of I/O so the reply-all rules can be unit-tested directly.
 */

import addressparser from 'nodemailer/lib/addressparser/index.js';

interface Mailbox { name: string; address: string }

/** Flatten nodemailer's parse result; members of an RFC 5322 group become plain mailboxes. */
function flatten(parsed: ReturnType<typeof addressparser>): Mailbox[] {
  return parsed.flatMap(entry => entry.group ? flatten(entry.group) : [{ name: entry.name, address: entry.address }]);
}

function formatMailbox({ name, address }: Mailbox): string {
  if (!name) return address;
  return /^[\w .'-]+$/.test(name) ? `${name} <${address}>` : `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`;
}

/**
 * Parse recipients with the same parser Nodemailer uses to build the SMTP
 * envelope, so what we dedupe is what actually gets delivered.
 * Policy: groups are expanded to their members (group syntax is dropped, the
 * envelope contains the members anyway); an entry without an address, e.g. an
 * empty group or garbage, is rejected instead of being passed through.
 */
export function parseRecipients(value?: string | string[]): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(value) ? value : [value ?? '']) {
    if (!raw.trim()) continue;
    const mailboxes = flatten(addressparser(raw));
    if (mailboxes.length === 0 || mailboxes.some(m => !m.address || !m.address.includes('@'))) {
      throw new Error(`Invalid recipient address: ${JSON.stringify(raw)}`);
    }
    out.push(...mailboxes.map(formatMailbox));
  }
  return out;
}

/**
 * Bare, lowercase address of a header entry that may carry a display name
 * ('Alice <Alice@Example.com>' → 'alice@example.com'). Addresses are compared
 * case-insensitively by convention (RFC 5321 §2.4).
 * Legacy matcher of reply-all, left untouched so it behaves as before when cc is omitted.
 */
export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).trim().toLowerCase();
}

/** Same as extractEmail, but through Nodemailer's parser; used for caller supplied recipients only. */
function parsedEmail(addr: string): string {
  const [first] = flatten(addressparser(addr));
  return (first?.address ?? addr).trim().toLowerCase();
}

export interface ReplySource {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string[];
  messageId: string;
  references?: string[];
}

/**
 * To/Cc for a reply (RFC 5322 §3.6.3).
 *
 * - Reply: To = original Reply-To if present, else From.
 * - Reply-all: To additionally gets the original To; Cc = the original Cc.
 *   The account's own addresses and duplicates are dropped (case-insensitive),
 *   otherwise the server delivers a copy back to our own INBOX. If that leaves
 *   To empty (e.g. replying to our own message), Cc is promoted to To.
 */
export function buildReplyRecipients(
  original: ReplySource,
  ownAddresses: Array<string | undefined>,
  replyAll: boolean,
): { to: string[]; cc: string[] } {
  const primary = original.replyTo && original.replyTo.length > 0
    ? original.replyTo
    : (original.from ? [original.from] : []);

  if (!replyAll) {
    return { to: [...primary], cc: [] };
  }

  const seen = new Set<string>(
    ownAddresses.filter((a): a is string => !!a && a.includes('@')).map(extractEmail),
  );
  const take = (list: string[] | undefined): string[] => {
    const out: string[] = [];
    for (const addr of list || []) {
      const normalized = extractEmail(addr);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        out.push(addr);
      }
    }
    return out;
  };

  let to = take([...primary, ...original.to]);
  let cc = take(original.cc);
  if (to.length === 0) {
    [to, cc] = [cc, []];
  }
  if (to.length === 0) {
    // Only ourselves on the original: answer the sender as a plain reply would.
    to = [...primary];
  }
  return { to, cc };
}

/** Split a recipient value given as a list or a comma-separated string (see parseRecipients). */
export function splitAddresses(value?: string | string[]): string[] {
  return parseRecipients(value);
}

/** Addresses of an already accepted recipient value; unparsable or empty groups contribute none. */
function lenientEmails(value: string): string[] {
  return flatten(addressparser(value)).map(m => m.address.trim().toLowerCase()).filter(Boolean);
}

/**
 * Additional recipients requested by the caller, minus the account's own
 * addresses, anything already in `existing`, and duplicates (case-insensitive).
 */
export function extraRecipients(
  existing: string[],
  extra: string | string[] | undefined,
  ownAddresses: Array<string | undefined>,
): string[] {
  const seen = new Set<string>([
    ...ownAddresses.filter((a): a is string => !!a && a.includes('@')).map(parsedEmail),
    ...existing.flatMap(lenientEmails),
  ]);
  return splitAddresses(extra).filter(addr => {
    const normalized = parsedEmail(addr);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * References for a reply: the original's References (or, failing that, its
 * In-Reply-To) followed by the original's Message-ID (RFC 5322 §3.6.4).
 */
export function buildReferences(original: ReplySource & { inReplyTo?: string }): string[] {
  const chain = original.references && original.references.length > 0
    ? [...original.references]
    : (original.inReplyTo ? original.inReplyTo.split(/\s+/).filter(Boolean) : []);
  if (original.messageId && !chain.includes(original.messageId)) {
    chain.push(original.messageId);
  }
  return chain;
}

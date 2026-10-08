/**
 * Recipient and threading headers for imap_reply_to_email.
 *
 * Kept free of I/O so the reply-all rules can be unit-tested directly.
 */

/**
 * Bare, lowercase address of a header entry that may carry a display name
 * ('Alice <Alice@Example.com>' → 'alice@example.com'). Addresses are compared
 * case-insensitively by convention (RFC 5321 §2.4).
 */
export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).trim().toLowerCase();
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

import type { ImapAccount } from '../types/index.js';
import addressparser from 'nodemailer/lib/addressparser/index.js';

/** Parse exactly one mailbox and return its case-insensitive bare address. */
export function parseSingleMailbox(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error('Sender must contain exactly one mailbox');
  }

  const parsed = addressparser(trimmed);
  if (parsed.length !== 1 || !parsed[0].address || parsed[0].group) {
    throw new Error('Sender must contain exactly one mailbox');
  }
  const address = parsed[0].address;
  const at = address.lastIndexOf('@');
  return `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;
}

export function allowedFromAddresses(account: ImapAccount): Set<string> {
  const addresses = new Set<string>();
  for (const value of [account.email, account.user, ...(account.allowedFrom ?? [])]) {
    if (!value) continue;
    try {
      addresses.add(parseSingleMailbox(value));
    } catch {
      // Account login names need not be email addresses. They authenticate but
      // are not sender identities unless they parse as exactly one mailbox.
    }
  }
  return addresses;
}

/**
 * Resolve an outbound From identity while preventing arbitrary header spoofing.
 * The account's email and login are always valid identities; additional aliases
 * must be configured explicitly through `allowedFrom`.
 */
export function resolveFrom(account: ImapAccount, requestedFrom?: string): string {
  const defaultFrom = account.email || account.user;
  if (!requestedFrom?.trim()) return defaultFrom;

  const requestedAddress = parseSingleMailbox(requestedFrom);
  if (!allowedFromAddresses(account).has(requestedAddress)) {
    throw new Error(`Sender ${requestedAddress} is not allowed for account ${defaultFrom}`);
  }

  return requestedFrom.trim();
}

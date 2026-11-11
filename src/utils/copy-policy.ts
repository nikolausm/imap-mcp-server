import type { CopyBehavior } from '../providers/email-providers.js';

/**
 * Which COPY destinations keep the original message where it is.
 *
 * Standard IMAP COPY (RFC 3501 6.4.7) leaves the source untouched, but some
 * providers map folders onto exclusive locations, where a copy can turn into a
 * move. What is known per provider lives in the provider registry
 * (`copyBehavior` in src/providers/email-providers.ts); this module only
 * applies it. It refuses or asks for acknowledgment; it never changes what is
 * sent.
 */

export type CopyDestinationClass =
  /** Known to keep the original in place. */
  | { kind: 'preserving' }
  /** Known or presumed to move/remove the original; always refused. */
  | { kind: 'refused'; reason: CopyRefusalReason; message: string }
  /** No known COPY behaviour for this provider: standard COPY should preserve, unconfirmed. */
  | { kind: 'unverified' };

export type CopyRefusalReason =
  | 'destination_is_trash_or_junk'
  | 'destination_may_move_source'
  | 'destination_not_verified';

export interface CopyDestinationInput {
  /** The account's provider display name, for messages (e.g. "Proton Mail"). */
  providerName?: string;
  /** The provider's COPY behaviour, if the registry has one. */
  behavior?: CopyBehavior;
  destination: string;
  /** RFC 6154 special-use of the destination, if the server reported one. */
  specialUse?: string;
}

const TRASH_OR_JUNK = new Set(['\\Trash', '\\Junk']);

const isInbox = (path: string) => path.toUpperCase() === 'INBOX';

export function classifyCopyDestination({ providerName, behavior, destination, specialUse }: CopyDestinationInput): CopyDestinationClass {
  // On every server: Gmail strips a message's labels when it is copied to
  // Trash or Spam, and nowhere is it a "keep it here too" request.
  if (specialUse && TRASH_OR_JUNK.has(specialUse)) {
    return {
      kind: 'refused',
      reason: 'destination_is_trash_or_junk',
      message:
        `"${destination}" is a Trash or Spam folder, and copying there is not a copy (on Gmail it removes the ` +
        'message\'s other labels). To trash or report a message, use imap_move_email or imap_delete_email instead.',
    };
  }

  if (!behavior) {
    return { kind: 'unverified' };
  }

  const on = providerName ? `On ${providerName}, ` : '';
  if (behavior.labelPrefixes?.some(p => destination.startsWith(p))) {
    return { kind: 'preserving' };
  }
  if ((behavior.inboxUnverified && isInbox(destination)) || behavior.unverifiedPrefixes?.some(p => destination.startsWith(p))) {
    return {
      kind: 'refused',
      reason: 'destination_not_verified',
      message:
        `${on}copying into the system folder "${destination}" has not been verified to keep the original in place, ` +
        'so it is refused. Copying into a label folder is allowed.',
    };
  }
  if (behavior.otherFolders === 'label') {
    return { kind: 'preserving' };
  }
  const labels = behavior.labelPrefixes?.map(p => `"${p}<name>"`).join(' or ');
  return {
    kind: 'refused',
    reason: 'destination_may_move_source',
    message:
      `${on}"${destination}" is an exclusive location, not a label: a copy there can take the message out of its ` +
      `current folder.${labels ? ` Only ${labels} destinations are allowed.` : ''} To move the message, use imap_move_email.`,
  };
}

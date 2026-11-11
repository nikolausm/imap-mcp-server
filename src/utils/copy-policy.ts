import type { CopyBehavior } from '../providers/email-providers.js';
import { isNonSelectable } from './search-folders.js';

/**
 * Which COPY destinations imap_copy_email accepts.
 *
 * Standard IMAP COPY (RFC 3501 6.4.7) leaves the source untouched, but some
 * providers map folders onto exclusive locations, where a copy can turn into a
 * move. System folders (RFC 6154 special-use roles) are refused on every
 * server. Beyond that, what is known per provider lives in the provider
 * registry (`copyBehavior` in src/providers/email-providers.ts); this module
 * only applies it. A provider rule describes how that provider is expected to
 * treat a folder; it is not a guarantee about any particular server. The
 * module refuses or asks for acknowledgment; it never changes what is sent.
 */

export type CopyDestinationClass =
  /** A label folder under the provider's registry rule: COPY is expected to add the label. */
  | { kind: 'label_destination' }
  /** Refused whatever the caller acknowledges. */
  | { kind: 'refused'; reason: CopyRefusalReason; message: string }
  /** No copy rule for this provider: needs the caller's acknowledgment. */
  | { kind: 'unverified' };

export type CopyRefusalReason =
  | 'destination_not_selectable'
  | 'destination_is_trash_or_junk'
  | 'destination_is_system_folder'
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
  /** The destination's LIST flags. Some servers put the special-use role
   * there without imapflow setting `specialUse`. */
  attributes?: string[];
}

const TRASH_OR_JUNK = new Set(['\\trash', '\\junk']);

/** RFC 6154 roles (plus Gmail's \Important) other than Trash and Junk. */
const SYSTEM_ROLES = new Set(['\\all', '\\archive', '\\drafts', '\\flagged', '\\sent', '\\important']);

const isInbox = (path: string) => path.toUpperCase() === 'INBOX';

/** True when the server marks the folder as Trash or Spam (\Trash / \Junk,
 * from specialUse or the LIST flags). imap_copy_email refuses such a source:
 * a COPY out of Trash can restore the message (Gmail drops it from Trash once
 * it has a label) instead of leaving the original where it was. */
export function isTrashOrJunk(specialUse: string | undefined, attributes: string[] | undefined): boolean {
  return [...rolesOf(specialUse, attributes)].some(r => TRASH_OR_JUNK.has(r));
}

/** Every role and flag the server attached to the folder, lower-cased. */
function rolesOf(specialUse: string | undefined, attributes: string[] | undefined): Set<string> {
  const roles = new Set<string>();
  for (const flag of [specialUse, ...(attributes ?? [])]) {
    if (flag) roles.add(flag.toLowerCase());
  }
  return roles;
}

export function classifyCopyDestination({
  providerName, behavior, destination, specialUse, attributes,
}: CopyDestinationInput): CopyDestinationClass {
  const roles = rolesOf(specialUse, attributes);

  if (isNonSelectable({ attributes: attributes ?? [] })) {
    return {
      kind: 'refused',
      reason: 'destination_not_selectable',
      message: `"${destination}" cannot hold messages (\\Noselect); it only groups other folders. Pick one of its subfolders.`,
    };
  }

  // On every server: Gmail strips a message's labels when it is copied to
  // Trash or Spam, and nowhere is it a "keep it here too" request.
  if ([...roles].some(r => TRASH_OR_JUNK.has(r))) {
    return {
      kind: 'refused',
      reason: 'destination_is_trash_or_junk',
      message:
        `"${destination}" is a Trash or Spam folder, and copying there is not a copy (on Gmail it removes the ` +
        'message\'s other labels). To trash or report a message, use imap_move_email or imap_delete_email instead.',
    };
  }

  // On every server, and before any provider rule: a folder the server marks
  // with a system role is never treated as a label, whatever its path.
  const systemRole = [...roles].find(r => SYSTEM_ROLES.has(r));
  if (systemRole) {
    return {
      kind: 'refused',
      reason: 'destination_is_system_folder',
      message:
        `"${destination}" is a system folder (${specialUseName(systemRole)}), and copying into system folders is refused ` +
        'on every server. Copy into a label or user folder instead, or use imap_move_email to move the message.',
    };
  }

  if (!behavior) {
    return { kind: 'unverified' };
  }

  const on = providerName ? `On ${providerName}, ` : '';
  if (behavior.labelPrefixes?.some(p => destination.startsWith(p))) {
    return { kind: 'label_destination' };
  }
  // Path checks for servers that report no role on their system folders.
  if ((behavior.inboxUnverified && isInbox(destination)) || behavior.unverifiedPrefixes?.some(p => destination.startsWith(p))) {
    return {
      kind: 'refused',
      reason: 'destination_not_verified',
      message:
        `${on}"${destination}" is a system folder, and copying into it is refused. ` +
        'Copying into a label folder is allowed.',
    };
  }
  if (behavior.otherFolders === 'label') {
    return { kind: 'label_destination' };
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

/** "\all" → "\All", for messages. */
function specialUseName(role: string): string {
  return `\\${role.charAt(1).toUpperCase()}${role.slice(2)}`;
}

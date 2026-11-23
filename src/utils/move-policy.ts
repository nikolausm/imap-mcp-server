/**
 * Optional allowlist of destination folders for imap_move_email.
 *
 * `IMAP_MCP_MOVE_ALLOWED_FOLDERS` is a comma-separated list of folder names
 * (e.g. `Trash,INBOX`). When it is set, a move whose target is not on the list
 * is refused before any IMAP call is made, so `createDestinationIfMissing`
 * can't create a folder outside the list either. When the variable is unset or
 * empty, every destination is allowed (original behavior).
 *
 * Matching is exact: the name that would be sent to the server must equal a
 * listed name byte for byte, because non-INBOX mailbox names may differ only
 * by case or whitespace and still be different folders. The one exception is
 * INBOX, which RFC 3501 §5.1 defines as case-insensitive. Whitespace around
 * the commas in the variable is ignored, so `Trash, INBOX` lists `Trash` and
 * `INBOX`.
 */

/** Parse the allowlist. Returns `null` when no restriction is configured. */
export function parseMoveAllowedFolders(
  value: string | undefined = process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS
): string[] | null {
  if (!value) return null;
  const folders = value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return folders.length > 0 ? folders : null;
}

const isInbox = (name: string) => name.toUpperCase() === 'INBOX';

/** True when `targetFolder` is exactly one of `allowed` (INBOX compared case-insensitively). */
export function isMoveTargetAllowed(targetFolder: string, allowed: string[]): boolean {
  return allowed.some(f => f === targetFolder || (isInbox(f) && isInbox(targetFolder)));
}

/**
 * Check a destination against the allowlist.
 * Returns `null` when the move is allowed, or a caller-facing error message.
 */
export function checkMoveTarget(
  targetFolder: string,
  allowed: string[] | null = parseMoveAllowedFolders()
): string | null {
  if (!allowed) return null;
  if (isMoveTargetAllowed(targetFolder, allowed)) return null;
  return `Moving to ${JSON.stringify(targetFolder)} is not allowed by IMAP_MCP_MOVE_ALLOWED_FOLDERS (allowed: ${allowed.map(f => JSON.stringify(f)).join(', ')}; names must match exactly, except INBOX). No messages were moved.`;
}

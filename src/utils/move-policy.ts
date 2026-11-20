/**
 * Optional allowlist of destination folders for imap_move_email.
 *
 * `IMAP_MCP_MOVE_ALLOWED_FOLDERS` is a comma-separated list of folder names
 * (e.g. `Trash,INBOX`). When it is set, a move whose target is not on the list
 * is refused before any IMAP call is made, and `createDestinationIfMissing`
 * cannot be used to create a folder outside the list. Matching is
 * case-insensitive and ignores surrounding whitespace. When the variable is
 * unset or empty, every destination is allowed (original behavior).
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

/**
 * Check a destination against the allowlist.
 * Returns `null` when the move is allowed, or a caller-facing error message.
 */
export function checkMoveTarget(
  targetFolder: string,
  allowed: string[] | null = parseMoveAllowedFolders()
): string | null {
  if (!allowed) return null;
  const wanted = targetFolder.trim().toLowerCase();
  if (allowed.some(f => f.toLowerCase() === wanted)) return null;
  return `Moving to "${targetFolder}" is not allowed by IMAP_MCP_MOVE_ALLOWED_FOLDERS (allowed: ${allowed.join(', ')}). No messages were moved.`;
}

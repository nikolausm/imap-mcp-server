/**
 * Merge an account-level default BCC list with an explicit per-call BCC value.
 * Explicit addresses come first; defaults are appended. Deduplication is
 * case-insensitive on the bare address (display-name wrappers ignored).
 * Returns `undefined` when the merge is empty, a single string for one
 * recipient, or an array for multiple — matching nodemailer's bcc shape.
 */
export function mergeBcc(
  defaultBcc: string | string[] | undefined,
  explicitBcc: string | string[] | undefined,
): string | string[] | undefined {
  const normalize = (value?: string | string[]): string[] => {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((entry) => entry.trim()).filter(Boolean);
  };

  const bareAddress = (addr: string): string => {
    const match = addr.match(/<([^>]+)>/);
    return (match ? match[1] : addr).trim().toLowerCase();
  };

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const addr of [...normalize(explicitBcc), ...normalize(defaultBcc)]) {
    const key = bareAddress(addr);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(addr);
  }

  if (merged.length === 0) return undefined;
  if (merged.length === 1) return merged[0];
  return merged;
}

/**
 * Recovery for MCP clients that serialize an array argument into a string.
 *
 * Several tool inputs accept "one or many" (`to`, `cc`, `bcc`, `references`,
 * `uid`). Those are Zod unions, which the MCP SDK renders as JSON Schema
 * `anyOf`. Some clients drop the `anyOf` when they hand the schema to the
 * model, leaving the field effectively untyped, and then JSON-stringify the
 * array the model produced. The server receives `'["a@x.com","b@y.com"]'`
 * instead of `['a@x.com', 'b@y.com']`.
 *
 * For UIDs that fails loudly (the string is not a number). For addresses it is
 * silently destructive: nodemailer folds the literal `[` and `]` into the
 * first and last address, so every recipient is rejected by the receiving MTA
 * and the whole send bounces (issue #127).
 *
 * `parseSerializedArray` restores the array before validation. Anything that is
 * not unambiguously a bracketed list is returned untouched.
 */

/** Strip one layer of matching single or double quotes. */
const unquote = (item: string): string => {
  const quote = item[0];
  if (item.length >= 2 && (quote === '"' || quote === "'") && item.endsWith(quote)) {
    return item.slice(1, -1).trim();
  }
  return item;
};

/** `'["a","b"]'` / `'[1,2]'` — the exact shape JSON.stringify produces. */
const fromJson = (text: string): (string | number)[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every(item => typeof item === 'string' || typeof item === 'number')) return null;
  return parsed as (string | number)[];
};

/**
 * `'[a@x.com, b@y.com]'` — brackets kept, items bare or loosely quoted, which
 * is what a model writes when it is told the field is a plain string but wants
 * to express a list. Splitting on commas cannot preserve a display name that
 * itself contains a comma; that shape only reaches us when JSON parsing already
 * failed, i.e. when the value was malformed to begin with.
 */
const fromBracketedList = (text: string): string[] | null => {
  const inner = text.slice(1, -1).trim();
  if (!inner) return null;
  const items = inner.split(',').map(item => unquote(item.trim()));
  if (items.some(item => item.length === 0)) return null;
  return items;
};

/**
 * Return `value` as a real array when it is a string holding a serialized
 * array; otherwise return `value` unchanged (including for real arrays,
 * numbers, and ordinary strings).
 *
 * `field` is only used for the stderr warning, so the user can see that their
 * client mangled the argument rather than wondering why the server "changed"
 * their input. Never log the values themselves — they are recipient addresses.
 */
export function parseSerializedArray(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return value;

  const items = fromJson(trimmed) ?? fromBracketedList(trimmed);
  if (!items) return value;

  console.error(
    `[imap-mcp] "${field}" arrived as a stringified array; recovered ${items.length} item(s). ` +
    'Your MCP client serialized an array argument into a string. ' +
    'Passing a single comma-separated string avoids this.'
  );
  return items;
}

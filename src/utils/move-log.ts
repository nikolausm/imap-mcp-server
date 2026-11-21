import { access, appendFile, link, mkdir, open, unlink } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { randomBytes } from 'crypto';

/**
 * Optional CSV audit log of imap_move_email calls.
 *
 * Set `IMAP_MCP_MOVE_LOG` to a file path to enable it. One row is appended per
 * message moved (or that failed to move), recording identifiers and envelope
 * headers only (sender, subject, date, Message-ID), never credentials or
 * bodies. The Message-ID column makes a move easy to undo with
 * imap_find_email_by_message_id, since IMAP UIDs change when a message moves.
 * When the variable is unset, nothing is read or written (original behavior).
 *
 * Because the rows contain mail metadata, a new log file is created with
 * owner-only permissions (0600 on POSIX; on Windows the file inherits the
 * folder's ACL, so choose a private folder). An existing file's permissions
 * are left as they are.
 */

export const MOVE_LOG_COLUMNS = [
  'timestamp_utc',
  'account',
  'source_folder',
  'uid',
  'target_folder',
  'new_uid',
  'status',
  'error',
  'from',
  'subject',
  'date',
  'message_id',
  'reason',
] as const;

export type MoveLogRow = Partial<Record<(typeof MOVE_LOG_COLUMNS)[number], string | number | undefined>>;

export const MOVE_LOG_FILE_MODE = 0o600;

export function getMoveLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.IMAP_MCP_MOVE_LOG?.trim();
  return value ? value : null;
}

/**
 * Quote one CSV cell (RFC 4180). Control characters are flattened to spaces.
 * Cells a spreadsheet would treat as a formula (leading =, +, -, @, tab, CR)
 * get a leading apostrophe, because sender and subject come from strangers and
 * the log is meant to be opened in a spreadsheet.
 */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  // eslint-disable-next-line no-control-regex
  let s = String(value).replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  if (/[",]/.test(s) || /^\s|\s$/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatMoveLogRow(row: MoveLogRow): string {
  return MOVE_LOG_COLUMNS.map(col => csvCell(row[col])).join(',');
}

/** UTF-8 BOM (so spreadsheets detect the encoding) plus the header line. */
export const MOVE_LOG_HEADER = '﻿' + MOVE_LOG_COLUMNS.join(',') + '\r\n';

/**
 * Create the log with its header if it doesn't exist yet, atomically.
 *
 * The header is written to a private temp file in the same folder, which is
 * then hard-linked to the final name. link() fails with EEXIST instead of
 * overwriting, so when several writers race to create the log exactly one
 * header wins, and no writer can ever see a half-written header or append rows
 * in front of it.
 */
async function ensureLogFile(path: string): Promise<void> {
  try {
    await access(path);
    return; // already there: never touch its header or permissions
  } catch {
    // missing: create it below
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', MOVE_LOG_FILE_MODE);
  try {
    await handle.writeFile(MOVE_LOG_HEADER, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, path);
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

// Serializes appends within this process so rows from concurrent tool calls
// never interleave. Across processes each call is one O_APPEND write.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Append rows to the log (creating it with a header on first use).
 * Failures are returned as a message, never thrown, so a logging problem can't
 * make a successful move look like it failed.
 */
export function appendMoveLog(path: string, rows: MoveLogRow[]): Promise<string | null> {
  if (rows.length === 0) return Promise.resolve(null);
  const run = async (): Promise<string | null> => {
    try {
      await ensureLogFile(path);
      const text = rows.map(formatMoveLogRow).join('\r\n') + '\r\n';
      await appendFile(path, text, { encoding: 'utf8', flag: 'a' });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  const result = queue.then(run, run);
  queue = result;
  return result;
}

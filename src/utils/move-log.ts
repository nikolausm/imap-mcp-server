import { appendFile, mkdir, stat } from 'fs/promises';
import { dirname } from 'path';

/**
 * Optional CSV audit log of imap_move_email calls.
 *
 * Set `IMAP_MCP_MOVE_LOG` to a file path to enable it. One row is appended per
 * message moved (or that failed to move), recording identifiers and envelope
 * headers only (sender, subject, date, Message-ID). Never credentials or bodies.
 * The Message-ID column makes a move easy to undo with
 * imap_find_email_by_message_id, since IMAP UIDs change when a message moves.
 * When the variable is unset, nothing is written (original behavior).
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

export function getMoveLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.IMAP_MCP_MOVE_LOG?.trim();
  return value ? value : null;
}

/**
 * Quote one CSV cell (RFC 4180). Cells that a spreadsheet would treat as a
 * formula (leading =, +, -, @, tab, CR) get a leading apostrophe, because
 * sender and subject come from strangers and the log is meant to be opened in
 * Excel.
 */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",]/.test(s) || /^\s|\s$/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatMoveLogRow(row: MoveLogRow): string {
  return MOVE_LOG_COLUMNS.map(col => csvCell(row[col])).join(',');
}

/**
 * Append rows to the log, writing the header first when the file is new.
 * Failures to write are reported to the caller, never thrown, so a logging
 * problem can't make a successful move look like it failed.
 */
export async function appendMoveLog(path: string, rows: MoveLogRow[]): Promise<string | null> {
  if (rows.length === 0) return null;
  try {
    let needsHeader = false;
    try {
      const info = await stat(path);
      needsHeader = info.size === 0;
    } catch {
      needsHeader = true;
      await mkdir(dirname(path), { recursive: true });
    }
    const lines = rows.map(formatMoveLogRow);
    if (needsHeader) lines.unshift(MOVE_LOG_COLUMNS.join(','));
    // Prefix a BOM on a new file so Excel reads UTF-8 subjects correctly.
    const text = (needsHeader ? '﻿' : '') + lines.join('\r\n') + '\r\n';
    await appendFile(path, text, 'utf8');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { emailTools } from '../src/tools/email-tools.js';
import { checkMoveTarget, parseMoveAllowedFolders } from '../src/utils/move-policy.js';
import { csvCell, formatMoveLogRow, MOVE_LOG_COLUMNS } from '../src/utils/move-log.js';

describe('move policy (IMAP_MCP_MOVE_ALLOWED_FOLDERS)', () => {
  it('is unrestricted when unset or blank', () => {
    expect(parseMoveAllowedFolders(undefined)).toBeNull();
    expect(parseMoveAllowedFolders(' , ')).toBeNull();
    expect(checkMoveTarget('Anything', null)).toBeNull();
  });

  it('matches case-insensitively and trims whitespace', () => {
    const allowed = parseMoveAllowedFolders(' Trash , INBOX ');
    expect(allowed).toEqual(['Trash', 'INBOX']);
    expect(checkMoveTarget('trash', allowed)).toBeNull();
    expect(checkMoveTarget(' Inbox ', allowed)).toBeNull();
    expect(checkMoveTarget('Archive', allowed)).toMatch(/not allowed.*allowed: Trash, INBOX/);
  });
});

describe('move log CSV formatting', () => {
  it('quotes commas and quotes, flattens newlines', () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('line1\nline2')).toBe('line1 line2');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralizes spreadsheet formulas from untrusted senders', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('writes columns in a fixed order', () => {
    const line = formatMoveLogRow({ uid: 5, status: 'moved', account: 'info@example.com' });
    expect(line.split(',')).toHaveLength(MOVE_LOG_COLUMNS.length);
    expect(line.startsWith(',info@example.com,,5,')).toBe(true);
  });
});

describe('imap_move_email with guard and log', () => {
  let handler: Function;
  let dir: string;
  const env = { ...process.env };
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: any, h: Function) => {
      if (name === 'imap_move_email') handler = h;
    }),
  };
  const mockImapService = { moveEmail: vi.fn(), fetchEnvelopesForUids: vi.fn() };
  const mockAccountManager = {
    resolveAccountId: (id: string) => id,
    getAccount: (id: string) => (id === 'acc1' ? { name: 'info@example.com' } : undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'move-log-'));
    delete process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS;
    delete process.env.IMAP_MCP_MOVE_LOG;
    emailTools(mockServer as any, mockImapService as any, mockAccountManager as any, {} as any);
  });

  afterEach(() => {
    process.env = { ...env };
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a disallowed destination without touching the mailbox', async () => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'Trash';
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: [1, 2], targetFolder: 'Archive', createDestinationIfMissing: true });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(false);
    expect(out.movedCount).toBe(0);
    expect(out.error).toMatch(/not allowed/);
    expect(mockImapService.moveEmail).not.toHaveBeenCalled();
  });

  it('allows a listed destination', async () => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'Trash';
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Trash', uidMap: new Map([[7, 70]]) });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 7, targetFolder: 'TRASH' });
    expect(JSON.parse(res.content[0].text).success).toBe(true);
    expect(mockImapService.moveEmail).toHaveBeenCalledOnce();
  });

  it('does not read headers or write a log when IMAP_MCP_MOVE_LOG is unset', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Trash' });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 7, targetFolder: 'Trash' });
    const out = JSON.parse(res.content[0].text);
    expect(out.logged).toBeUndefined();
    expect(mockImapService.fetchEnvelopesForUids).not.toHaveBeenCalled();
  });

  it('logs each message of a batch with envelope, new uid, status and reason', async () => {
    const logPath = join(dir, 'sub', 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValueOnce(new Map([
      [10, { from: 'Ella <ella@spam.test>', subject: 'Affordable, App "Solutions"', date: '2026-11-18T05:22:29.000Z', messageId: '<a@spam.test>' }],
      [11, { from: 'x@y.test', subject: '=cmd', date: 'd', messageId: '<b@y.test>' }],
    ]));
    mockImapService.moveEmail.mockResolvedValueOnce({
      destination: 'Trash',
      results: [
        { uid: 10, destination: 'Trash', uidMap: { 10: 633 } },
        { uid: 11, destination: 'Trash', error: 'NO [TRYCREATE]' },
      ],
    });

    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: [10, 11], targetFolder: 'Trash', reason: 'rule 4' });
    const out = JSON.parse(res.content[0].text);
    expect(out.logged).toBe(true);
    expect(out.movedCount).toBe(1);

    const text = readFileSync(logPath, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(MOVE_LOG_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',info@example.com,INBOX,10,Trash,633,moved,,');
    expect(lines[1]).toContain('"Affordable, App ""Solutions"""');
    expect(lines[1]).toContain('<a@spam.test>,rule 4');
    expect(lines[2]).toContain(',11,Trash,,failed,NO [TRYCREATE],');
    expect(lines[2]).toContain(",'=cmd,");
  });

  it('appends without repeating the header and logs single moves', async () => {
    const logPath = join(dir, 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValue(new Map([[5, { from: '', subject: 's', date: '', messageId: '' }]]));
    mockImapService.moveEmail.mockResolvedValue({ path: 'INBOX', destination: 'Trash', uidMap: new Map([[5, 50]]) });
    await handler({ accountId: 'acc1', folder: 'INBOX', uid: 5, targetFolder: 'Trash' });
    await handler({ accountId: 'acc1', folder: 'INBOX', uid: 5, targetFolder: 'Trash' });
    const lines = readFileSync(logPath, 'utf8').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',5,Trash,50,moved,');
  });

  it('logs a whole-call failure as failed rows', async () => {
    const logPath = join(dir, 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValueOnce(new Map());
    mockImapService.moveEmail.mockRejectedValueOnce(new Error('connection lost'));
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: [1, 2], targetFolder: 'Trash' });
    expect(JSON.parse(res.content[0].text).success).toBe(false);
    const lines = readFileSync(logPath, 'utf8').trim().split('\r\n');
    expect(lines.slice(1).every(l => l.includes(',failed,connection lost,'))).toBe(true);
  });

  it('still moves, and says so, when the log cannot be written', async () => {
    process.env.IMAP_MCP_MOVE_LOG = join(dir, 'moves.csv');
    mockImapService.fetchEnvelopesForUids.mockRejectedValueOnce(new Error('header fetch failed'));
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Trash' });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 3, targetFolder: 'Trash' });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(true);
    expect(out.logged).toBe(false);
    expect(out.logWarning).toMatch(/header fetch failed/);
    expect(existsSync(join(dir, 'moves.csv'))).toBe(true);
  });
});

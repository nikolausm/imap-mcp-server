import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { emailTools } from '../src/tools/email-tools.js';
import { appendMoveLog, csvCell, formatMoveLogRow, MOVE_LOG_COLUMNS, MOVE_LOG_HEADER } from '../src/utils/move-log.js';

const isPosix = process.platform !== 'win32';
const dataLines = (path: string) => readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split('\r\n');

describe('move log CSV formatting', () => {
  it('quotes commas and quotes, flattens newlines and control characters', () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('line1\nline2\r\x07x')).toBe('line1 line2  x');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralizes spreadsheet formulas from untrusted senders', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('writes columns in a fixed order', () => {
    const line = formatMoveLogRow({ uid: 5, status: 'moved', account: 'info@example.com' });
    expect(line.split(',')).toHaveLength(MOVE_LOG_COLUMNS.length);
    expect(line.startsWith(',info@example.com,,5,')).toBe(true);
  });
});

describe('appendMoveLog file handling', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'move-log-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates the folder and file with a BOM and header on first use', async () => {
    const path = join(dir, 'a', 'b', 'moves.csv');
    expect(await appendMoveLog(path, [{ uid: 1, status: 'moved' }])).toBeNull();
    const text = readFileSync(path, 'utf8');
    expect(text.startsWith(MOVE_LOG_HEADER)).toBe(true);
    expect(dataLines(path)).toHaveLength(2);
  });

  it.runIf(isPosix)('creates a new log with owner-only permissions (0600)', async () => {
    const path = join(dir, 'moves.csv');
    await appendMoveLog(path, [{ uid: 1 }]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("leaves an existing file's permissions and content alone", async () => {
    const path = join(dir, 'moves.csv');
    writeFileSync(path, 'my,own,header\r\n');
    chmodSync(path, 0o640);
    await appendMoveLog(path, [{ uid: 2 }]);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(readFileSync(path, 'utf8').startsWith('my,own,header\r\n')).toBe(true);
  });

  it('writes exactly one header when many writers create the log at once, and keeps every row', async () => {
    const path = join(dir, 'moves.csv');
    // Separate module instances stand in for separate server processes:
    // each has its own in-process queue, so only the file-level guard protects them.
    const writers = await Promise.all(
      Array.from({ length: 4 }, async () => {
        vi.resetModules();
        return (await import('../src/utils/move-log.js')).appendMoveLog;
      })
    );
    const calls = writers.flatMap((write, w) =>
      Array.from({ length: 10 }, (_, i) => write(path, [{ uid: w * 100 + i, status: 'moved' }]))
    );
    expect(await Promise.all(calls)).toEqual(Array(40).fill(null));

    const lines = dataLines(path);
    expect(lines.filter(l => l === MOVE_LOG_COLUMNS.join(','))).toHaveLength(1);
    expect(lines[0]).toBe(MOVE_LOG_COLUMNS.join(','));
    expect(lines).toHaveLength(41);
    const uids = lines.slice(1).map(l => Number(l.split(',')[3])).sort((a, b) => a - b);
    expect(new Set(uids).size).toBe(40);
    // no temp files left behind
    expect(readdirSync(dir)).toEqual(['moves.csv']);
  });

  it('returns the error instead of throwing when the log cannot be written', async () => {
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const result = await appendMoveLog(join(blocker, 'moves.csv'), [{ uid: 1 }]);
    expect(result).toEqual(expect.any(String));
  });
});

describe('imap_move_email with IMAP_MCP_MOVE_LOG', () => {
  let handler: Function;
  let dir: string;
  const env = process.env.IMAP_MCP_MOVE_LOG;
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
    dir = mkdtempSync(join(tmpdir(), 'move-log-tool-'));
    delete process.env.IMAP_MCP_MOVE_LOG;
    emailTools(mockServer as any, mockImapService as any, mockAccountManager as any, {} as any);
  });

  afterEach(() => {
    if (env === undefined) delete process.env.IMAP_MCP_MOVE_LOG;
    else process.env.IMAP_MCP_MOVE_LOG = env;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads nothing extra and writes nothing when the variable is unset', async () => {
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Trash' });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 7, targetFolder: 'Trash' });
    const out = JSON.parse(res.content[0].text);
    expect(out.logged).toBeUndefined();
    expect(mockImapService.fetchEnvelopesForUids).not.toHaveBeenCalled();
  });

  it('logs each message of a batch with envelope, new uid, status and reason', async () => {
    const logPath = join(dir, 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValueOnce(new Map([
      [10, { from: 'Ella <ella@spam.test>', subject: 'Affordable, App "Solutions"', date: '2026-11-18T05:22:29.000Z', messageId: '<a@spam.test>' }],
      [11, { from: 'x@y.test', subject: '=cmd', date: '', messageId: '<b@y.test>' }],
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

    const lines = dataLines(logPath);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',info@example.com,INBOX,10,Trash,633,moved,,');
    expect(lines[1]).toContain('"Affordable, App ""Solutions"""');
    expect(lines[1]).toContain('<a@spam.test>,rule 4');
    expect(lines[2]).toContain(',11,Trash,,failed,NO [TRYCREATE],');
    expect(lines[2]).toContain(",'=cmd,");
  });

  it('logs single moves and appends without repeating the header', async () => {
    const logPath = join(dir, 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValue(new Map([[5, { from: '', subject: 's', date: '', messageId: '' }]]));
    mockImapService.moveEmail.mockResolvedValue({ path: 'INBOX', destination: 'Trash', uidMap: new Map([[5, 50]]) });
    await handler({ accountId: 'acc1', folder: 'INBOX', uid: 5, targetFolder: 'Trash' });
    await handler({ accountId: 'acc1', folder: 'INBOX', uid: 5, targetFolder: 'Trash' });
    const lines = dataLines(logPath);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',5,Trash,50,moved,');
  });

  it('logs a whole-call failure as failed rows and reports logged', async () => {
    const logPath = join(dir, 'moves.csv');
    process.env.IMAP_MCP_MOVE_LOG = logPath;
    mockImapService.fetchEnvelopesForUids.mockResolvedValueOnce(new Map());
    mockImapService.moveEmail.mockRejectedValueOnce(new Error('connection lost'));
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: [1, 2], targetFolder: 'Trash' });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(false);
    expect(out.logged).toBe(true);
    expect(dataLines(logPath).slice(1).every(l => l.includes(',failed,connection lost,'))).toBe(true);
  });

  it('still moves, and says so, when the headers or the log cannot be written', async () => {
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

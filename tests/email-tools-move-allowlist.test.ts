import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';
import { checkMoveTarget, isMoveTargetAllowed, parseMoveAllowedFolders } from '../src/utils/move-policy.js';

describe('move allowlist parsing and matching', () => {
  it('is unrestricted when unset or blank', () => {
    expect(parseMoveAllowedFolders(undefined)).toBeNull();
    expect(parseMoveAllowedFolders('')).toBeNull();
    expect(parseMoveAllowedFolders(' , ')).toBeNull();
    expect(checkMoveTarget('Anything', null)).toBeNull();
  });

  it('ignores whitespace around the commas in the variable', () => {
    expect(parseMoveAllowedFolders(' Trash , INBOX ')).toEqual(['Trash', 'INBOX']);
  });

  it('matches non-INBOX names exactly', () => {
    const allowed = ['Archive', 'Trash'];
    expect(isMoveTargetAllowed('Archive', allowed)).toBe(true);
    expect(isMoveTargetAllowed('archive', allowed)).toBe(false);
    expect(isMoveTargetAllowed('ARCHIVE', allowed)).toBe(false);
    expect(isMoveTargetAllowed('Archive ', allowed)).toBe(false);
    expect(isMoveTargetAllowed(' Archive', allowed)).toBe(false);
    expect(isMoveTargetAllowed('Archive/2026', allowed)).toBe(false);
  });

  it('treats INBOX case-insensitively (RFC 3501 §5.1) but nothing else', () => {
    expect(isMoveTargetAllowed('inbox', ['INBOX'])).toBe(true);
    expect(isMoveTargetAllowed('INBOX', ['Inbox'])).toBe(true);
    expect(isMoveTargetAllowed('INBOX ', ['INBOX'])).toBe(false);
    expect(isMoveTargetAllowed('INBOX/Sub', ['INBOX'])).toBe(false);
    expect(isMoveTargetAllowed('inbox', ['Trash'])).toBe(false);
  });

  it('explains the refusal with the exact names', () => {
    expect(checkMoveTarget('trash', ['Trash'])).toMatch(/"trash" is not allowed.*allowed: "Trash".*match exactly/);
  });
});

describe('imap_move_email honors IMAP_MCP_MOVE_ALLOWED_FOLDERS', () => {
  let handler: Function;
  const env = process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS;
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: any, h: Function) => {
      if (name === 'imap_move_email') handler = h;
    }),
  };
  // Every IMAP-touching method the move path could reach.
  const mockImapService = {
    moveEmail: vi.fn(),
    folderExists: vi.fn(),
    createFolder: vi.fn(),
    selectFolder: vi.fn(),
  };
  const mockAccountManager = { resolveAccountId: vi.fn((id: string) => id) };

  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(mockServer as any, mockImapService as any, mockAccountManager as any, {} as any);
  });

  afterEach(() => {
    if (env === undefined) delete process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS;
    else process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = env;
  });

  const expectNoImapCall = () => {
    expect(mockImapService.moveEmail).not.toHaveBeenCalled();
    expect(mockImapService.folderExists).not.toHaveBeenCalled();
    expect(mockImapService.createFolder).not.toHaveBeenCalled();
    expect(mockImapService.selectFolder).not.toHaveBeenCalled();
  };

  it.each([
    ['a folder not on the list', 'Archive'],
    ['a case variant', 'trash'],
    ['a trailing-space variant', 'Trash '],
    ['a leading-space variant', ' Trash'],
    ['a subfolder of an allowed folder', 'Trash/Old'],
  ])('refuses %s without any IMAP call', async (_label, target) => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'Trash,INBOX';
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: [1, 2], targetFolder: target });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(false);
    expect(out.movedCount).toBe(0);
    expect(out.error).toMatch(/not allowed by IMAP_MCP_MOVE_ALLOWED_FOLDERS/);
    expectNoImapCall();
  });

  it('refuses before folder creation when createDestinationIfMissing is set', async () => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'Trash';
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 3, targetFolder: 'NewFolder', createDestinationIfMissing: true });
    expect(JSON.parse(res.content[0].text).success).toBe(false);
    expectNoImapCall();
  });

  it('allows the exact name and passes it through unchanged', async () => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'Trash';
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Trash' });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 7, targetFolder: 'Trash' });
    expect(JSON.parse(res.content[0].text).success).toBe(true);
    expect(mockImapService.moveEmail).toHaveBeenCalledWith('acc1', 'INBOX', 7, 'Trash', { createDestinationIfMissing: undefined });
  });

  it('allows INBOX in any case', async () => {
    process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS = 'INBOX';
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'Trash', destination: 'inbox' });
    const res = await handler({ accountId: 'acc1', folder: 'Trash', uid: 9, targetFolder: 'inbox' });
    expect(JSON.parse(res.content[0].text).success).toBe(true);
  });

  it('does not restrict anything when the variable is unset', async () => {
    delete process.env.IMAP_MCP_MOVE_ALLOWED_FOLDERS;
    mockImapService.moveEmail.mockResolvedValueOnce({ path: 'INBOX', destination: 'Anything' });
    const res = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 1, targetFolder: 'Anything' });
    expect(JSON.parse(res.content[0].text).success).toBe(true);
  });
});

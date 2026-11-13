import { describe, it, expect, vi, beforeEach } from 'vitest';
import { folderTools } from '../src/tools/folder-tools.js';
import { ImapOperationError } from '../src/utils/operation-error.js';

let renameFolderHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_rename_folder') {
      renameFolderHandler = handler;
    }
  }),
};

const mockImapService = {
  renameFolder: vi.fn(),
};

async function call(args: Record<string, unknown>) {
  const result = await renameFolderHandler({ accountId: 'acc1', ...args });
  return JSON.parse(result.content[0].text);
}

describe('imap_rename_folder Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('should be registered', () => {
    expect(renameFolderHandler).toBeDefined();
  });

  it('reports the old and new path and the renamed children', async () => {
    mockImapService.renameFolder.mockResolvedValueOnce({
      oldPath: 'Projects',
      newPath: 'Clients',
      renamedChildren: [{ oldPath: 'Projects/Acme', newPath: 'Clients/Acme' }],
    });

    const parsed = await call({ folder: 'Projects', newName: 'Clients' });

    expect(mockImapService.renameFolder).toHaveBeenCalledWith('acc1', 'Projects', 'Clients');
    expect(parsed.success).toBe(true);
    expect(parsed.oldPath).toBe('Projects');
    expect(parsed.newPath).toBe('Clients');
    expect(parsed.renamedChildren).toEqual([{ oldPath: 'Projects/Acme', newPath: 'Clients/Acme' }]);
    expect(parsed.message).toContain('1 child folder');
  });

  it.each([
    ['source_not_found', 'Folder "Nope" does not exist'],
    ['destination_exists', 'A folder named "Clients" already exists; it was not replaced'],
    ['inbox_not_supported', 'Renaming INBOX, or renaming a folder to INBOX, is not supported'],
    ['same_name', '"Projects" already has that name'],
    ['server_refused', 'Server refused'],
    ['outcome_unknown', 'did not complete'],
  ])('returns success:false with reason %s', async (reason, message) => {
    mockImapService.renameFolder.mockRejectedValueOnce(new ImapOperationError(reason, message));

    const parsed = await call({ folder: 'Projects', newName: 'Clients' });

    expect(parsed.success).toBe(false);
    expect(parsed.reason).toBe(reason);
    expect(parsed.error).toBe(message);
    expect(parsed.folder).toBe('Projects');
    expect(parsed.newName).toBe('Clients');
  });

  it('uses reason server_error for unexpected errors', async () => {
    mockImapService.renameFolder.mockRejectedValueOnce(new Error('Failed to reconnect'));

    const parsed = await call({ folder: 'Projects', newName: 'Clients' });

    expect(parsed.success).toBe(false);
    expect(parsed.reason).toBe('server_error');
  });
});

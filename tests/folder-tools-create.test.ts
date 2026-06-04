import { describe, it, expect, vi, beforeEach } from 'vitest';
import { folderTools } from '../src/tools/folder-tools.js';

let createFolderHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_create_folder') {
      createFolderHandler = handler;
    }
  }),
};

const mockImapService = {
  createFolder: vi.fn(),
};

describe('imap_create_folder Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('should be registered', () => {
    expect(createFolderHandler).toBeDefined();
  });

  it('should report success when a new folder is created', async () => {
    mockImapService.createFolder.mockResolvedValueOnce({
      path: 'Archives/2026',
      created: true,
      alreadyExisted: false,
    });

    const result = await createFolderHandler({ accountId: 'acc1', folder: 'Archives/2026' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.created).toBe(true);
    expect(parsed.alreadyExisted).toBe(false);
    expect(parsed.message).toContain('created');
  });

  it('should report success when the folder already existed', async () => {
    mockImapService.createFolder.mockResolvedValueOnce({
      path: 'INBOX',
      created: false,
      alreadyExisted: true,
    });

    const result = await createFolderHandler({ accountId: 'acc1', folder: 'INBOX' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.alreadyExisted).toBe(true);
    expect(parsed.message).toContain('already existed');
  });

  it('should report failure when service throws', async () => {
    mockImapService.createFolder.mockRejectedValueOnce(new Error('Permission denied'));

    const result = await createFolderHandler({ accountId: 'acc1', folder: 'Forbidden' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Permission denied');
  });
});

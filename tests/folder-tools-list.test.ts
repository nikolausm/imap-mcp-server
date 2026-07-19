import { describe, it, expect, vi, beforeEach } from 'vitest';
import { folderTools } from '../src/tools/folder-tools.js';

/**
 * Covers imap_list_folders — issue #125: the tool must expose the RFC 6154
 * special-use role so callers can identify localized folders ("Gesendet" →
 * \Sent) without guessing by name.
 */
let listFoldersHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_list_folders') {
      listFoldersHandler = handler;
    }
  }),
};

const mockImapService = {
  listFolders: vi.fn(),
};

describe('imap_list_folders Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('exposes attributes and the RFC 6154 specialUse role per folder', async () => {
    mockImapService.listFolders.mockResolvedValueOnce([
      { name: 'INBOX', delimiter: '/', attributes: ['\\HasNoChildren'] },
      { name: 'Gesendet', delimiter: '/', attributes: ['\\HasNoChildren', '\\Sent'], specialUse: '\\Sent' },
      { name: 'Entwürfe', delimiter: '/', attributes: ['\\HasNoChildren', '\\Drafts'], specialUse: '\\Drafts' },
    ]);

    const result = await listFoldersHandler({ accountId: 'acc1' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.folders).toHaveLength(3);
    expect(parsed.folders[1]).toMatchObject({
      name: 'Gesendet',
      attributes: ['\\HasNoChildren', '\\Sent'],
      specialUse: '\\Sent',
    });
    // Folders without a special-use role simply omit the field (JSON drops undefined).
    expect(parsed.folders[0].specialUse).toBeUndefined();
    expect(parsed.folders[0].attributes).toEqual(['\\HasNoChildren']);
  });
});

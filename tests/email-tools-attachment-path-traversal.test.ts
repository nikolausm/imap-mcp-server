import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

// The download dir is read into a module-level const when email-tools is
// imported, so point it at a throwaway temp dir BEFORE the import below.
const TMP_DOWNLOAD_DIR = path.join(os.tmpdir(), `imap-attach-traversal-${process.pid}`);
process.env.IMAP_DOWNLOAD_DIR = TMP_DOWNLOAD_DIR;

const { emailTools } = await import('../src/tools/email-tools.js');

let downloadHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_download_attachment') {
      downloadHandler = handler;
    }
  }),
};

const mockImapService = {
  getAttachmentContent: vi.fn(),
};
const mockAccountManager = { resolveAccountId: (id: string) => id ?? 'acc1' };
const mockSmtpService = {};

describe('imap_download_attachment — path traversal via sender-controlled filename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  afterAll(async () => {
    await fsp.rm(TMP_DOWNLOAD_DIR, { recursive: true, force: true });
  });

  it('confines a "../" attachment filename to the download directory', async () => {
    // A malicious sender names the attachment to climb out of the download dir.
    mockImapService.getAttachmentContent.mockResolvedValueOnce({
      content: Buffer.from('pwned'),
      contentType: 'application/octet-stream',
      filename: '../../../../../../tmp/imap-mcp-escape.txt',
    });

    const result = await downloadHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      filename: '../../../../../../tmp/imap-mcp-escape.txt',
      extractText: false,
    });

    const parsed = JSON.parse(result.content[0].text);
    const savedTo = path.resolve(parsed.path);
    const downloadRoot = path.resolve(TMP_DOWNLOAD_DIR);

    // The file must land INSIDE the download dir, with the traversal stripped.
    expect(savedTo.startsWith(downloadRoot + path.sep)).toBe(true);
    expect(path.basename(savedTo)).toBe('imap-mcp-escape.txt');
    expect(path.dirname(savedTo)).toBe(downloadRoot);
  });
});

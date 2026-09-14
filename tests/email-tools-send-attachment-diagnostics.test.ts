import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { emailTools } from '../src/tools/email-tools.js';

let sendEmailHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_send_email') {
      sendEmailHandler = handler;
    }
  }),
};

const account: any = {
  id: 'acc1',
  name: 'Test',
  email: 'user@example.com',
  user: 'user@example.com',
};

const mockImapService = {
  appendToSentFolder: vi.fn(),
};

const mockAccountManager = {
  resolveAccountId: (id: string) => id,
  getAccount: vi.fn(async () => account),
};

const mockSmtpService = {
  composeRaw: vi.fn(async () => Buffer.from('RAW')),
  sendEmail: vi.fn(async () => ({ messageId: '<msg-1@example.com>', rawMessage: 'RAW' })),
};

const baseArgs = {
  accountId: 'acc1',
  to: 'rcpt@example.com',
  subject: 'Hi',
  text: 'Hello',
};

describe('imap_send_email attachment diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  it.each([
    [
      'both content and path',
      { filename: 'report.pdf', content: Buffer.from('pdf').toString('base64'), path: '/tmp/report.pdf' },
      'provide exactly one of content or path',
    ],
    ['invalid base64', { filename: 'report.pdf', content: 'not valid base64' }, 'content is not valid base64'],
    [
      'inline without cid',
      { filename: 'logo.png', content: Buffer.from('png').toString('base64'), contentDisposition: 'inline' },
      'cid is required for inline attachments',
    ],
  ])('fails before SMTP when attachment has %s', async (_name, attachment, message) => {
    await expect(sendEmailHandler({ ...baseArgs, attachments: [attachment] }))
      .rejects.toThrow(`Invalid attachment at index 0: ${message}`);
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
    expect(mockSmtpService.composeRaw).not.toHaveBeenCalled();
    expect(mockImapService.appendToSentFolder).not.toHaveBeenCalled();
  });

  it('does not disclose supplied paths when a path attachment is unreadable', async () => {
    const suppliedPath = join(tmpdir(), 'imap-mcp-private-path', 'missing-secret-report.pdf');

    let thrown: unknown;
    try {
      await sendEmailHandler({
        ...baseArgs,
        attachments: [{ filename: 'report.pdf', path: suppliedPath }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe('Invalid attachment at index 0: path is not a readable file. Check that the attachment path exists, points to a regular file, and is readable.');
    expect(message).not.toContain(suppliedPath);
    expect(message).not.toContain('missing-secret-report.pdf');
    expect(message).not.toContain('imap-mcp-private-path');
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
    expect(mockSmtpService.composeRaw).not.toHaveBeenCalled();
    expect(mockImapService.appendToSentFolder).not.toHaveBeenCalled();
  });

  it('returns safe diagnostics after a successful send', async () => {
    mockImapService.appendToSentFolder.mockResolvedValueOnce({ saved: true, folder: 'Sent' });

    const result = await sendEmailHandler({
      ...baseArgs,
      attachments: [{
        filename: '../report.pdf',
        content: Buffer.from('pdf bytes').toString('base64'),
        contentType: 'application/pdf',
      }],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.attachmentCount).toBe(1);
    expect(parsed.attachmentDiagnostics).toEqual([{
      index: 0, filename: 'report.pdf', contentType: 'application/pdf',
      size: 9, source: 'content', contentDisposition: 'attachment',
    }]);
    expect(JSON.stringify(parsed.attachmentDiagnostics)).not.toContain('pdf bytes');
  });

  it('dry-runs by composing MIME without sending or saving to Sent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'imap-mcp-attachments-'));
    const filePath = join(dir, 'invoice.pdf');
    await writeFile(filePath, Buffer.from('file bytes'));

    const result = await sendEmailHandler({
      ...baseArgs,
      dryRun: true,
      attachments: [{
        filename: 'invoice.pdf',
        path: filePath,
        contentType: 'application/pdf',
      }],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockSmtpService.composeRaw).toHaveBeenCalledOnce();
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
    expect(mockImapService.appendToSentFolder).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({
      success: true, dryRun: true, attachmentCount: 1,
      attachmentDiagnostics: [{
        index: 0, filename: 'invoice.pdf', contentType: 'application/pdf',
        size: 10, source: 'path', contentDisposition: 'attachment',
      }],
    });
    expect(JSON.stringify(parsed)).not.toContain(filePath);
  });
});

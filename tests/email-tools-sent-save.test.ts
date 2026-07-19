import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

/**
 * Covers the Sent-copy reporting of imap_send_email — issue #125: when the
 * copy cannot be saved, the tool response must say so (sentSaveError) instead
 * of a bare savedToSent:false, and the account's sentFolder override must be
 * passed through to the service.
 */
let sendEmailHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_send_email') {
      sendEmailHandler = handler;
    }
  }),
};

const mockImapService = {
  appendToSentFolder: vi.fn(),
};

const account: any = {
  id: 'acc1',
  name: 'Test',
  email: 'user@example.com',
  user: 'user@example.com',
};

const mockAccountManager = {
  resolveAccountId: (id: string) => id,
  getAccount: vi.fn(async () => account),
};

const mockSmtpService = {
  sendEmail: vi.fn(async () => ({ messageId: '<msg-1@example.com>', rawMessage: 'RAW' })),
};

const sendArgs = { accountId: 'acc1', to: 'rcpt@example.com', subject: 'Hi', text: 'Hello' };

describe('imap_send_email Sent-copy reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete account.saveToSent;
    delete account.sentFolder;
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  it('reports the folder the copy was saved to', async () => {
    mockImapService.appendToSentFolder.mockResolvedValueOnce({ saved: true, folder: 'Gesendet' });

    const result = await sendEmailHandler(sendArgs);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.savedToSent).toBe(true);
    expect(parsed.sentFolder).toBe('Gesendet');
    expect(parsed.sentSaveError).toBeUndefined();
    expect(parsed.message).toContain('saved to "Gesendet"');
  });

  it('passes the account sentFolder override to the service', async () => {
    account.sentFolder = 'Custom/Sent';
    mockImapService.appendToSentFolder.mockResolvedValueOnce({ saved: true, folder: 'Custom/Sent' });

    await sendEmailHandler(sendArgs);

    expect(mockImapService.appendToSentFolder).toHaveBeenCalledWith('acc1', 'RAW', 'Custom/Sent');
  });

  it('surfaces the failure reason as sentSaveError instead of failing silently', async () => {
    mockImapService.appendToSentFolder.mockResolvedValueOnce({
      saved: false,
      error: 'No Sent folder found: the server advertises no \\Sent SPECIAL-USE folder…',
    });

    const result = await sendEmailHandler(sendArgs);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true); // the send itself succeeded
    expect(parsed.savedToSent).toBe(false);
    expect(parsed.sentSaveError).toContain('No Sent folder found');
    expect(parsed.message).toContain('NOT saved to Sent folder');
  });

  it('reports an unexpected service exception as sentSaveError', async () => {
    mockImapService.appendToSentFolder.mockRejectedValueOnce(new Error('connection lost'));

    const result = await sendEmailHandler(sendArgs);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.savedToSent).toBe(false);
    expect(parsed.sentSaveError).toBe('connection lost');
  });

  it('skips the save (no error, no attempt) when saveToSent is disabled', async () => {
    account.saveToSent = false;

    const result = await sendEmailHandler(sendArgs);
    const parsed = JSON.parse(result.content[0].text);

    expect(mockImapService.appendToSentFolder).not.toHaveBeenCalled();
    expect(parsed.savedToSent).toBe(false);
    expect(parsed.sentSaveError).toBeUndefined();
    expect(parsed.message).toBe('Email sent successfully');
  });
});

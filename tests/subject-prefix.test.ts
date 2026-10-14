import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

describe('reply and forward subject prefixes (#203)', () => {
  const handlers = new Map<string, Function>();
  const account: any = { id: 'acc1', name: 'Test', email: 'me@example.com', user: 'me@example.com' };
  const mockImapService = {
    getEmailContent: vi.fn(),
    appendToSentFolder: vi.fn(async () => ({ saved: true, folder: 'Sent' })),
  };
  const mockSmtpService = {
    sendEmail: vi.fn(async () => ({ messageId: '<r@example.com>', rawMessage: Buffer.from('RAW') })),
  };

  const sentSubject = async (tool: string, subject: string): Promise<string> => {
    mockImapService.getEmailContent.mockResolvedValueOnce({
      uid: 7,
      date: new Date('2026-10-01T08:00:00Z'),
      from: 'Alice <alice@example.org>',
      to: ['me@example.com'],
      cc: [],
      replyTo: [],
      subject,
      messageId: '<m1@example.org>',
      references: [],
      flags: [],
      customKeywords: [],
      headers: {},
      attachments: [],
      textContent: 'Hi',
    });
    await handlers.get(tool)!({ accountId: 'acc1', folder: 'INBOX', uid: 7, to: ['bob@example.org'], text: 'ok' });
    const calls = mockSmtpService.sendEmail.mock.calls as any[];
    return calls[calls.length - 1][2].subject;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    const server = {
      registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
        handlers.set(name, handler);
      }),
    };
    const accountManager = { resolveAccountId: (id: string) => id, getAccount: vi.fn(async () => account) };
    emailTools(server as any, mockImapService as any, accountManager as any, mockSmtpService as any);
  });

  it('adds Re: to an unprefixed subject', async () => {
    expect(await sentSubject('imap_reply_to_email', 'Budget')).toBe('Re: Budget');
  });

  it.each(['Re: Budget', 'RE: Budget', 're: Budget', 'Re:Budget', 'RE : Budget', 'AW: Budget', 'aw:Budget'])(
    'keeps the existing reply prefix in %s',
    async (subject) => {
      expect(await sentSubject('imap_reply_to_email', subject)).toBe(subject);
    },
  );

  it.each(['Fwd: Budget', 'FW: Budget', 'Fw:Budget'])('still adds Re: when replying to %s', async (subject) => {
    expect(await sentSubject('imap_reply_to_email', subject)).toBe(`Re: ${subject}`);
  });

  it('adds Fwd: to an unprefixed subject', async () => {
    expect(await sentSubject('imap_forward_email', 'Budget')).toBe('Fwd: Budget');
  });

  it.each(['Fwd: Budget', 'FWD: Budget', 'fwd:Budget', 'FW: Budget', 'fw : Budget', 'WG: Budget'])(
    'keeps the existing forward prefix in %s',
    async (subject) => {
      expect(await sentSubject('imap_forward_email', subject)).toBe(subject);
    },
  );

  it.each(['Re: Budget', 'RE: Budget', 'AW: Budget'])('still adds Fwd: when forwarding %s', async (subject) => {
    expect(await sentSubject('imap_forward_email', subject)).toBe(`Fwd: ${subject}`);
  });

  it('does not treat a word starting with the prefix letters as a prefix', async () => {
    expect(await sentSubject('imap_reply_to_email', 'Report: Q3')).toBe('Re: Report: Q3');
    expect(await sentSubject('imap_forward_email', 'Fwdx: Q3')).toBe('Fwd: Fwdx: Q3');
  });
});

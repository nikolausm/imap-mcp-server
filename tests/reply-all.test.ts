import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleParser } from 'mailparser';
import { emailTools } from '../src/tools/email-tools.js';
import { ImapService } from '../src/services/imap-service.js';
import { SmtpService } from '../src/services/smtp-service.js';
import { buildReferences, buildReplyRecipients, extractEmail } from '../src/utils/reply-headers.js';
import type { EmailContent, ImapAccount } from '../src/types/index.js';

/**
 * imap_reply_to_email with replyAll: true used to send to the original sender
 * only: Cc recipients were dropped, Reply-To was ignored, References held just
 * the parent's Message-ID instead of the whole chain (RFC 5322 §3.6.4), and a
 * multi-address To arrived as one joined string so the self-filter missed.
 */

const original = (over: Partial<EmailContent> = {}): EmailContent => ({
  uid: 7,
  date: new Date('2026-10-01T08:00:00Z'),
  from: 'Alice <alice@example.org>',
  to: ['Me <Me@Example.com>', 'Bob <bob@example.org>'],
  cc: ['carol@example.org', 'ME@example.com'],
  replyTo: [],
  subject: 'Plans',
  messageId: '<m3@example.org>',
  inReplyTo: '<m2@example.org>',
  references: ['<m1@example.org>', '<m2@example.org>'],
  flags: [],
  customKeywords: [],
  headers: {},
  attachments: [],
  ...over,
});

describe('reply header helpers', () => {
  it('extractEmail strips display names and lowercases', () => {
    expect(extractEmail('Alice <Alice@Example.ORG>')).toBe('alice@example.org');
    expect(extractEmail(' bob@example.org ')).toBe('bob@example.org');
  });

  it('plain reply goes to the sender only', () => {
    expect(buildReplyRecipients(original(), ['me@example.com'], false))
      .toEqual({ to: ['Alice <alice@example.org>'], cc: [] });
  });

  it('reply-all keeps Cc as Cc and drops our own address case-insensitively', () => {
    expect(buildReplyRecipients(original(), ['me@example.com', 'me'], true)).toEqual({
      to: ['Alice <alice@example.org>', 'Bob <bob@example.org>'],
      cc: ['carol@example.org'],
    });
  });

  it('honours Reply-To instead of From', () => {
    const msg = original({ replyTo: ['List <list@example.org>'] });
    expect(buildReplyRecipients(msg, ['me@example.com'], false).to).toEqual(['List <list@example.org>']);
    expect(buildReplyRecipients(msg, ['me@example.com'], true).to)
      .toEqual(['List <list@example.org>', 'Bob <bob@example.org>']);
  });

  it('removes duplicates across To and Cc', () => {
    const msg = original({ to: ['me@example.com', 'ALICE@example.org'], cc: ['Bob <BOB@example.org>', 'bob@example.org'] });
    expect(buildReplyRecipients(msg, ['me@example.com'], true)).toEqual({
      to: ['Alice <alice@example.org>'],
      cc: ['Bob <BOB@example.org>'],
    });
  });

  it('replying-all to our own message addresses its recipients', () => {
    const msg = original({ from: 'me@example.com', to: ['me@example.com'], cc: ['carol@example.org'] });
    expect(buildReplyRecipients(msg, ['me@example.com'], true)).toEqual({ to: ['carol@example.org'], cc: [] });
  });

  it('References = parent References + parent Message-ID', () => {
    expect(buildReferences(original())).toEqual(['<m1@example.org>', '<m2@example.org>', '<m3@example.org>']);
    expect(buildReferences(original({ references: [] }))).toEqual(['<m2@example.org>', '<m3@example.org>']);
    expect(buildReferences(original({ references: [], inReplyTo: undefined }))).toEqual(['<m3@example.org>']);
  });
});

describe('ImapService parses Cc, Reply-To and References per address', () => {
  it('splits multi-address headers into one entry per address', async () => {
    const raw = Buffer.from([
      'From: Alice <alice@example.org>',
      'To: Me <me@example.com>, Bob <bob@example.org>',
      'Cc: carol@example.org, "Dan D" <dan@example.org>',
      'Reply-To: List <list@example.org>',
      'Subject: Plans',
      'Message-ID: <m3@example.org>',
      'In-Reply-To: <m2@example.org>',
      'References: <m1@example.org> <m2@example.org>',
      '',
      'Hi',
      '',
    ].join('\r\n'));
    const svc = new ImapService() as any;
    const email: EmailContent = await svc.buildEmailContentFromSource(7, raw, new Set(), { bodyFormat: 'text' });
    expect(email.to).toEqual(['Me <me@example.com>', 'Bob <bob@example.org>']);
    expect(email.cc).toEqual(['carol@example.org', 'Dan D <dan@example.org>']);
    expect(email.replyTo).toEqual(['List <list@example.org>']);
    expect(email.references).toEqual(['<m1@example.org>', '<m2@example.org>']);
  });
});

describe('imap_reply_to_email tool', () => {
  let replyHandler: Function;
  const account: any = { id: 'acc1', name: 'Test', email: 'me@example.com', user: 'me@example.com' };
  const mockImapService = {
    getEmailContent: vi.fn(async () => original()),
    appendToSentFolder: vi.fn(async () => ({ saved: true, folder: 'Sent' })),
  };
  const mockSmtpService = {
    sendEmail: vi.fn(async () => ({ messageId: '<r@example.com>', rawMessage: Buffer.from('RAW') })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const server = {
      registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
        if (name === 'imap_reply_to_email') replyHandler = handler;
      }),
    };
    const accountManager = { resolveAccountId: (id: string) => id, getAccount: vi.fn(async () => account) };
    emailTools(server as any, mockImapService as any, accountManager as any, mockSmtpService as any);
  });

  it('replyAll sends To + Cc and the full References chain', async () => {
    await replyHandler({ accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: true });
    const composed = (mockSmtpService.sendEmail.mock.calls[0] as any[])[2];
    expect(composed.to).toEqual(['Alice <alice@example.org>', 'Bob <bob@example.org>']);
    expect(composed.cc).toEqual(['carol@example.org']);
    expect(composed.inReplyTo).toBe('<m3@example.org>');
    expect(composed.references).toEqual(['<m1@example.org>', '<m2@example.org>', '<m3@example.org>']);
    expect(composed.subject).toBe('Re: Plans');
  });

  it('plain reply has no Cc', async () => {
    await replyHandler({ accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false });
    const composed = (mockSmtpService.sendEmail.mock.calls[0] as any[])[2];
    expect(composed.to).toEqual(['Alice <alice@example.org>']);
    expect(composed.cc).toBeUndefined();
  });
});

describe('SmtpService.sendEmail Message-ID (#187)', () => {
  const account: ImapAccount = {
    id: 'acc1', name: 'Test', host: 'imap.example.com', port: 993,
    user: 'me@example.com', password: 'pw', tls: true, email: 'me@example.com',
  };

  it('Sent copy, SMTP message and returned messageId share one Message-ID', async () => {
    const smtp = new SmtpService();
    const sendMail = vi.fn(async (opts: any) => ({ messageId: opts.messageId }));
    vi.spyOn(smtp, 'createTransporter').mockResolvedValue({ sendMail } as any);

    const { messageId, rawMessage } = await smtp.sendEmail('acc1', account, {
      from: 'Me <me@example.com>',
      to: ['alice@example.org'],
      cc: ['carol@example.org'],
      subject: 'Re: Plans',
      text: 'ok',
      inReplyTo: '<m3@example.org>',
      references: ['<m1@example.org>', '<m3@example.org>'],
    });

    const parsed = await simpleParser(rawMessage!);
    expect(messageId).toMatch(/^<[0-9a-f-]+@example\.com>$/);
    expect(sendMail.mock.calls[0][0].messageId).toBe(messageId);
    expect(parsed.messageId).toBe(messageId);
    expect(parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc.text : '').toBe('carol@example.org');
    expect(parsed.references).toEqual(['<m1@example.org>', '<m3@example.org>']);
  });
});

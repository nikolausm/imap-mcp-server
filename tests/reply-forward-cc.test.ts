import nodemailer from 'nodemailer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';
import { extraRecipients, splitAddresses } from '../src/utils/reply-headers.js';
import type { EmailContent } from '../src/types/index.js';

/**
 * imap_reply_to_email had no cc, so adding someone to a thread meant falling
 * back to imap_send_email and losing In-Reply-To/References.
 */

const original: EmailContent = {
  uid: 7,
  date: new Date('2026-10-01T08:00:00Z'),
  from: 'Alice <alice@example.org>',
  to: ['Me <Me@Example.com>', 'Bob <bob@example.org>'],
  cc: ['carol@example.org'],
  replyTo: [],
  subject: 'Plans',
  messageId: '<m3@example.org>',
  inReplyTo: '<m2@example.org>',
  references: ['<m1@example.org>', '<m2@example.org>'],
  textContent: 'Hi',
  flags: [],
  customKeywords: [],
  headers: {},
  attachments: [],
};

describe('recipient helpers', () => {
  it('splitAddresses accepts lists and comma-separated strings, keeps quoted commas', () => {
    expect(splitAddresses('a@example.org, "Doe, John" <john@example.org> ,')).toEqual(['a@example.org', '"Doe, John" <john@example.org>']);
    expect(splitAddresses(['a@example.org', 'b@example.org, c@example.org'])).toEqual(['a@example.org', 'b@example.org', 'c@example.org']);
    expect(splitAddresses(undefined)).toEqual([]);
  });

  it('extraRecipients drops existing, own and duplicate addresses case-insensitively', () => {
    expect(extraRecipients(
      ['Bob <bob@example.org>'],
      'BOB@example.org, me@EXAMPLE.com, dan@example.org, Dan <DAN@example.org>',
      ['me@example.com'],
    )).toEqual(['dan@example.org']);
  });
});

describe('cc on imap_reply_to_email and imap_forward_email', () => {
  const handlers: Record<string, Function> = {};
  const account: any = { id: 'acc1', name: 'Test', email: 'me@example.com', user: 'me@example.com' };
  const mockImapService = {
    getEmailContent: vi.fn(async () => original),
    appendToSentFolder: vi.fn(async () => ({ saved: true, folder: 'Sent' })),
  };
  const mockSmtpService = {
    sendEmail: vi.fn(async () => ({ messageId: '<r@example.com>', rawMessage: Buffer.from('RAW') })),
  };
  const composed = () => (mockSmtpService.sendEmail.mock.calls[0] as any[])[2];

  beforeEach(() => {
    vi.clearAllMocks();
    const server = {
      registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
        handlers[name] = handler;
      }),
    };
    const accountManager = { resolveAccountId: (id: string) => id, getAccount: vi.fn(async () => account) };
    emailTools(server as any, mockImapService as any, accountManager as any, mockSmtpService as any);
  });

  it('plain reply adds cc and keeps threading', async () => {
    await handlers.imap_reply_to_email({
      accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false,
      cc: 'dan@example.org, "Doe, John" <john@example.org>',
    });
    expect(composed().to).toEqual(['Alice <alice@example.org>']);
    expect(composed().cc).toEqual(['dan@example.org', '"Doe, John" <john@example.org>']);
    expect(composed().inReplyTo).toBe('<m3@example.org>');
    expect(composed().references).toEqual(['<m1@example.org>', '<m2@example.org>', '<m3@example.org>']);
  });

  it('replyAll merges cc with the original Cc without duplicates or own address', async () => {
    await handlers.imap_reply_to_email({
      accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: true,
      cc: ['ALICE@example.org', 'Carol <CAROL@example.org>', 'me@example.com', 'dan@example.org'],
    });
    expect(composed().to).toEqual(['Alice <alice@example.org>', 'Bob <bob@example.org>']);
    expect(composed().cc).toEqual(['carol@example.org', 'dan@example.org']);
  });

  it('reply without cc stays without Cc', async () => {
    await handlers.imap_reply_to_email({ accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false });
    expect(composed().cc).toBeUndefined();
  });

  it('forward adds cc deduped against To and own address', async () => {
    await handlers.imap_forward_email({
      accountId: 'acc1', folder: 'INBOX', uid: 7, includeAttachments: false,
      to: 'frank@example.org',
      cc: 'FRANK@example.org, me@example.com, gina@example.org',
    });
    expect(composed().to).toBe('frank@example.org');
    expect(composed().cc).toEqual(['gina@example.org']);
    expect(composed().subject).toBe('Fwd: Plans');
  });

  describe('SMTP envelope (nodemailer stream transport, offline)', () => {
    const envelopeOf = async (mail: any) => {
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const info: any = await t.sendMail({ from: 'me@example.com', ...mail });
      return info.envelope.to as string[];
    };

    it('own mailbox inside an address group is filtered from the envelope', async () => {
      await handlers.imap_reply_to_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false,
        cc: 'Team: me@example.com, dan@example.org;',
      });
      expect(composed().cc).toEqual(['dan@example.org']);
      expect(await envelopeOf({ to: composed().to, cc: composed().cc })).toEqual(['alice@example.org', 'dan@example.org']);
    });

    it('own mailbox after a display name containing angle brackets is filtered', async () => {
      await handlers.imap_reply_to_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false,
        cc: '"Evil <x@example.net>" <me@example.com>, dan@example.org',
      });
      expect(composed().cc).toEqual(['dan@example.org']);
      expect(await envelopeOf({ to: composed().to, cc: composed().cc })).toEqual(['alice@example.org', 'dan@example.org']);
    });

    it('forward: cc duplicate of a To member inside a group is dropped', async () => {
      await handlers.imap_forward_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, includeAttachments: false,
        to: 'Friends: frank@example.org;', cc: 'frank@example.org, me@example.com, gina@example.org',
      });
      expect(await envelopeOf({ to: composed().to, cc: composed().cc })).toEqual(['frank@example.org', 'gina@example.org']);
    });

    it('rejects malformed recipients instead of passing them through', async () => {
      await expect(handlers.imap_reply_to_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false, cc: 'not-an-address',
      })).rejects.toThrow(/Invalid recipient/);
      await expect(handlers.imap_reply_to_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: false, cc: 'Empty:;',
      })).rejects.toThrow(/Invalid recipient/);
    });

    it('forward without cc leaves To untouched', async () => {
      await handlers.imap_forward_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, includeAttachments: false, to: 'Friends: frank@example.org;',
      });
      expect(composed().to).toBe('Friends: frank@example.org;');
      expect(composed().cc).toBeUndefined();
    });

    it('legacy forward: empty named To group with Bcc only still reaches the envelope', async () => {
      await handlers.imap_forward_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, includeAttachments: false,
        to: 'Undisclosed:;', bcc: 'hidden@example.org',
      });
      expect(composed().to).toBe('Undisclosed:;');
      expect(composed().cc).toBeUndefined();
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const info: any = await t.sendMail({ from: 'me@example.com', to: composed().to, bcc: 'hidden@example.org' });
      expect(info.envelope.to).toEqual(['hidden@example.org']);
    });

    it('forward with cc and an empty To group keeps To as given', async () => {
      await handlers.imap_forward_email({
        accountId: 'acc1', folder: 'INBOX', uid: 7, includeAttachments: false,
        to: 'Undisclosed:;', cc: 'gina@example.org', bcc: 'hidden@example.org',
      });
      expect(composed().to).toBe('Undisclosed:;');
      expect(composed().cc).toEqual(['gina@example.org']);
    });

    it('replyAll without cc keeps the legacy recipient normalization', async () => {
      await handlers.imap_reply_to_email({ accountId: 'acc1', folder: 'INBOX', uid: 7, text: 'ok', replyAll: true });
      expect(composed().to).toEqual(['Alice <alice@example.org>', 'Bob <bob@example.org>']);
      expect(composed().cc).toEqual(['carol@example.org']);
    });
  });
});

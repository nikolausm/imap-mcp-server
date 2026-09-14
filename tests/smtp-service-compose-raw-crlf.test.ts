import { describe, it, expect } from 'vitest';
import { SmtpService } from '../src/services/smtp-service.js';
import type { ImapAccount } from '../src/types/index.js';

/**
 * MimeNode streams 7bit/8bit text content through unchanged, so a bare LF in
 * the caller's text/html survives into the built MIME buffer. RFC 5322 requires
 * CRLF, and strict IMAP servers (Cyrus) reject the whole APPEND for a bare LF
 * (#170). SMTP sending was never affected, only the Drafts/Sent copies that go
 * through composeRaw.
 */
const account: ImapAccount = {
  id: 'acc1',
  name: 'Test',
  host: 'imap.example.com',
  port: 993,
  user: 'user@example.com',
  password: 'pw',
  tls: true,
  email: 'user@example.com',
};

const bareLfCount = (raw: Buffer) => {
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0a && (i === 0 || raw[i - 1] !== 0x0d)) count++;
  }
  return count;
};

describe('SmtpService.composeRaw line endings', () => {
  const smtp = new SmtpService();

  it('emits CRLF for every line break in a multi-line plain-text body', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: 'Hi',
      text: 'line one\nline two\nline three',
    });

    expect(bareLfCount(raw)).toBe(0);
    expect(raw.toString()).toContain('line one\r\nline two\r\nline three');
  });

  it('emits CRLF for every line break in a multi-line HTML body', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: 'Hi',
      html: '<p>line one</p>\n<p>line two</p>',
    });

    expect(bareLfCount(raw)).toBe(0);
  });

  it('does not double up line breaks that already are CRLF', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: 'Hi',
      text: 'line one\r\nline two',
    });

    expect(bareLfCount(raw)).toBe(0);
    expect(raw.toString()).toContain('line one\r\nline two');
    expect(raw.toString()).not.toContain('line one\r\n\r\nline two');
  });
});

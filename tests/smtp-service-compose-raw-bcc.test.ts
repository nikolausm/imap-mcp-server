import { describe, it, expect } from 'vitest';
import { SmtpService } from '../src/services/smtp-service.js';
import type { ImapAccount } from '../src/types/index.js';

/**
 * MailComposer strips Bcc from built MIME unless keepBcc is set. Drafts and
 * Sent-folder copies go through composeRaw, so without keepBcc the Bcc header
 * promised by defaultBcc (#143) never appears in the stored message.
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

const headerOf = (raw: string, name: string) => {
  const headers = raw.split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  const start = headers.findIndex(line => line.startsWith(`${name}: `));
  if (start === -1) return '';
  const folded = [headers[start]];
  for (let i = start + 1; i < headers.length && /^[ \t]/.test(headers[i]); i++) {
    folded.push(headers[i].trim());
  }
  return folded.join(' ').slice(name.length + 2);
};

describe('SmtpService.composeRaw keepBcc', () => {
  const smtp = new SmtpService();

  it('includes a Bcc header in the raw MIME when bcc is set', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      bcc: 'archive@example.com',
      subject: 'Hi',
      text: 'Hello',
    });

    expect(headerOf(raw.toString(), 'Bcc')).toBe('archive@example.com');
  });

  it('includes every address when bcc is an array', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      bcc: ['archive@example.com', 'copy@example.com'],
      subject: 'Hi',
      text: 'Hello',
    });

    const bcc = headerOf(raw.toString(), 'Bcc');
    expect(bcc).toContain('archive@example.com');
    expect(bcc).toContain('copy@example.com');
  });

  it('omits Bcc when no bcc recipients are set', async () => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: 'Hi',
      text: 'Hello',
    });

    expect(headerOf(raw.toString(), 'Bcc')).toBe('');
    expect(raw.toString()).not.toMatch(/^Bcc:/im);
  });
});

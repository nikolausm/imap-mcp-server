import { describe, it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import { SmtpService } from '../src/services/smtp-service.js';
import type { ImapAccount } from '../src/types/index.js';

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

describe('SmtpService.composeRaw attachments', () => {
  const smtp = new SmtpService();

  it.each([
    ['report.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n% test pdf\n')],
    ['proposal.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK\u0003\u0004docx fixture bytes')],
  ])('includes %s filename, type, and bytes', async (filename, contentType, bytes) => {
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: filename,
      text: 'See attached',
      attachments: [{ filename, content: bytes, contentType }],
    });

    const parsed = await simpleParser(raw);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe(filename);
    expect(parsed.attachments[0].contentType).toBe(contentType);
    expect(parsed.attachments[0].content.equals(bytes)).toBe(true);
  });

  it('includes inline image disposition, cid, type, and bytes', async () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const raw = await smtp.composeRaw(account, {
      from: 'user@example.com',
      to: 'rcpt@example.com',
      subject: 'Inline',
      html: '<p>Logo <img src="cid:logo-image"></p>',
      attachments: [{
        filename: 'logo.png',
        content: pngBytes,
        contentType: 'image/png',
        contentDisposition: 'inline',
        cid: 'logo-image',
      }],
    });

    const parsed = await simpleParser(raw);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe('logo.png');
    expect(parsed.attachments[0].contentType).toBe('image/png');
    expect(parsed.attachments[0].contentDisposition).toBe('inline');
    expect(parsed.attachments[0].contentId).toBe('<logo-image>');
    expect(parsed.attachments[0].content.equals(pngBytes)).toBe(true);
  });
});

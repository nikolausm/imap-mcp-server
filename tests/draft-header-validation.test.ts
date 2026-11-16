import { describe, it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { transportMessage } from '../src/services/draft-service.js';
import { SmtpService } from '../src/services/smtp-service.js';

const headers = 'From: sender@example.test\r\nTo: visible@example.test\r\nSubject: Review\r\nMessage-ID: <saved@example.test>\r\nBcc: hidden@example.test,\r\n\tsecond@example.test';
const body = Buffer.from('body with a lone LF\nand a lone CR\r; Bcc: this is body text\r\n\u0000\u00ff', 'latin1');
const raw = Buffer.concat([Buffer.from(headers + '\r\n\r\n'), body]);
const bodyOf = (message: Buffer) => message.subarray(message.indexOf('\r\n\r\n') + 4);
const stream = () => nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

describe('strict draft header boundaries', () => {
  it('reproduces real parser and local-stream exposure of an unfiltered lone-LF Bcc', async () => {
    const malformed = Buffer.from('From: sender@example.test\r\nTo: visible@example.test\r\nSubject: Review\nBcc: hidden@example.test\r\n\r\nBody');
    const parsed = await simpleParser(malformed);
    expect(parsed.bcc?.text).toContain('hidden@example.test');
    // In-memory stream transport only: no SMTP, socket, credentials or mailbox.
    const delivered = await stream().sendMail({ envelope: { from: 'sender@example.test', to: ['visible@example.test', 'hidden@example.test'] }, raw: malformed });
    expect((await simpleParser(delivered.message)).bcc?.text).toContain('hidden@example.test');
    expect(() => transportMessage(malformed, '<saved@example.test>')).toThrow('lone CR or LF');
  });
  it.each(['\n', '\r'].flatMap(ending => ['Bcc', 'From', 'Message-ID', 'Resent-To'].map(field => ({ ending, field }))))('rejects $field after $ending in send and edit', async ({ ending, field }) => {
    const malformed = Buffer.concat([Buffer.from(`X-Note: value${ending}${field}: hidden@example.test\r\n`), raw]);
    expect(() => transportMessage(malformed, '<saved@example.test>')).toThrow('lone CR or LF');
    expect(() => transportMessage(malformed, '<saved@example.test>', true)).toThrow('lone CR or LF');
    await expect(new SmtpService().patchDraft(malformed, { subject: 'Edited' })).rejects.toThrow('lone CR or LF');
  });
  it('rejects entirely LF-delimited headers', async () => {
    const malformed = Buffer.from('From: sender@example.test\nBcc: hidden@example.test\n\nBody');
    expect(() => transportMessage(malformed, '<saved@example.test>')).toThrow('CRLF headers');
    await expect(new SmtpService().patchDraft(malformed, { subject: 'Edited' })).rejects.toThrow('CRLF headers');
  });
  it('strips valid folded Bcc, preserves envelope recipients through Nodemailer and leaves body bytes unchanged', async () => {
    const parsed = await simpleParser(raw);
    const recipients = [...parsed.to!.value, ...parsed.bcc!.value].map(v => v.address!);
    const wire = transportMessage(raw, parsed.messageId!);
    expect(bodyOf(wire)).toEqual(body);
    expect((await simpleParser(wire)).bcc).toBeUndefined();
    const delivered = await stream().sendMail({ envelope: { from: 'sender@example.test', to: recipients }, raw: wire });
    expect(delivered.envelope.to).toEqual(['visible@example.test', 'hidden@example.test', 'second@example.test']);
    expect((await simpleParser(delivered.message)).bcc).toBeUndefined();
    // Nodemailer stream transport applies its own wire newline rules. Byte
    // preservation is asserted at our rewrite boundary above and below.
    const edited = await new SmtpService().patchDraft(raw, { subject: 'Edited', bcc: [] });
    expect(bodyOf(edited)).toEqual(body);
    expect((await simpleParser(edited)).bcc).toBeUndefined();
  });
  it('preserves multipart attachment bytes through rewrite and real local stream transport', async () => {
    const smtp = new SmtpService();
    const attachment = Buffer.from([0, 255, 13, 10, 13, 128, 10]);
    const mime = await smtp.composeRaw({ user: 'sender@example.test' } as any, {
      to: 'visible@example.test', bcc: 'hidden@example.test', subject: 'Synthetic', text: 'Body',
      attachments: [{ filename: 'bytes.bin', content: attachment, contentType: 'application/octet-stream' }],
    });
    const parsed = await simpleParser(mime);
    const wire = transportMessage(mime, parsed.messageId!);
    expect(bodyOf(wire)).toEqual(bodyOf(mime));
    const delivered = await stream().sendMail({ envelope: { from: 'sender@example.test', to: ['visible@example.test', 'hidden@example.test'] }, raw: wire });
    const received = await simpleParser(delivered.message);
    expect(received.bcc).toBeUndefined();
    expect(received.attachments[0].content).toEqual(attachment);
    const edited = await smtp.patchDraft(mime, { subject: 'Changed' });
    expect(bodyOf(edited)).toEqual(bodyOf(mime));
    expect((await simpleParser(edited)).attachments[0].content).toEqual(attachment);
  });

});

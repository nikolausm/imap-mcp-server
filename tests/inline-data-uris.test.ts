import { describe, it, expect } from 'vitest';
import { stripInlineDataUris } from '../src/services/html-to-markdown.js';
import { ImapService } from '../src/services/imap-service.js';

// 24 KB of image data as base64 (32768 characters).
const LOGO = 'A'.repeat(32768);

describe('stripInlineDataUris', () => {
  it('replaces a data URI with a placeholder carrying type and decoded size', () => {
    const out = stripInlineDataUris(`before data:image/jpeg;base64,${LOGO} after`);
    expect(out).toBe('before [inline image, image/jpeg, 24 KB] after');
  });

  it('accepts additional parameters before ;base64', () => {
    const out = stripInlineDataUris('x data:image/png;name=logo.png;charset=binary;base64,QUJD y');
    expect(out).toBe('x [inline image, image/png, 3 B] y');
  });

  it('accounts for base64 padding and labels non-image types as data', () => {
    expect(stripInlineDataUris('data:application/pdf;base64,QUI=')).toBe('[inline data, application/pdf, 2 B]');
  });

  it('handles a data URI without a media type', () => {
    expect(stripInlineDataUris('data:;base64,QUJD')).toBe('[inline data, 3 B]');
  });

  it('replaces every occurrence', () => {
    const out = stripInlineDataUris(`a data:image/gif;base64,${LOGO} b data:image/png;base64,${LOGO} c`);
    expect(out).toBe('a [inline image, image/gif, 24 KB] b [inline image, image/png, 24 KB] c');
  });

  it('replaces the source of an HTML img tag and a Markdown image', () => {
    expect(stripInlineDataUris(`<img src="data:image/png;base64,${LOGO}" alt="x">`)).toBe(
      '<img src="[inline image, image/png, 24 KB]" alt="x">',
    );
    expect(stripInlineDataUris(`![x](data:image/png;base64,${LOGO})`)).toBe(
      '![x]([inline image, image/png, 24 KB])',
    );
  });

  it('leaves text without a base64 data URI untouched', () => {
    const text = 'See data:text/plain,hello and https://example.org/a;base64,b';
    expect(stripInlineDataUris(text)).toBe(text);
  });

  it('passes empty and undefined through', () => {
    expect(stripInlineDataUris('')).toBe('');
    expect(stripInlineDataUris(undefined)).toBeUndefined();
  });
});

describe('body assembly with an inline data URI', () => {
  const raw = Buffer.from([
    'From: Alice <alice@example.org>',
    'To: Bob <bob@example.org>',
    'Subject: Forwarded',
    'Message-ID: <m1@example.org>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Logo: data:image/jpeg;base64,${LOGO}`,
    '',
    'The actual message text.',
    '',
  ].join('\r\n'));

  it('keeps the text after the image when the body is truncated', async () => {
    const svc = new ImapService() as any;
    const email = await svc.buildEmailContentFromSource(1, raw, new Set(), { bodyMaxLength: 200 });
    expect(email.markdownContent).toContain('[inline image, image/jpeg, 24 KB]');
    expect(email.markdownContent).toContain('The actual message text.');
    expect(email.markdownContent).not.toContain('base64');
    expect(email.textContent).not.toContain('base64');
  });

  it('strips the URI for every body format', async () => {
    const svc = new ImapService() as any;
    for (const bodyFormat of ['text', 'html', 'markdown', 'auto']) {
      const email = await svc.buildEmailContentFromSource(1, raw, new Set(), { bodyFormat });
      const body = [email.textContent, email.htmlContent, email.markdownContent].join('\n');
      expect(body).not.toContain(';base64,');
      expect(body).toContain('The actual message text.');
    }
  });
});

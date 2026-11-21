import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildQuotedReply, bodyInner, headStyles, referencedCids, displayAddress, formatSent } from '../src/utils/reply-quote.js';
import { emailTools } from '../src/tools/email-tools.js';

const OUTLOOK_HTML =
  '<html><head><meta charset="us-ascii"><style><!-- p.MsoNormal{margin:0in;font-family:"Aptos"} --></style></head>' +
  '<body lang=EN-US><div class=WordSection1><p class=MsoNormal>Hey Stavros,</p><ol><li>One</li><li>Two</li></ol>' +
  '<p><a href="https://form.example/agent">Agent form</a></p><img src="cid:image001.png@01DD782E.C3317510" alt="logo">' +
  '<img src="cid:logo2@x">' + '<p>' + 'x'.repeat(130_000) + '</p></div></body></html>';

describe('reply-quote helpers', () => {
  it('takes the original body and keeps its head styles', () => {
    expect(bodyInner(OUTLOOK_HTML).startsWith('<div class=WordSection1>')).toBe(true);
    expect(headStyles(OUTLOOK_HTML)).toContain('p.MsoNormal');
    expect(bodyInner('<p>no body tag</p>')).toBe('<p>no body tag</p>');
  });

  it('finds the cid: links the HTML uses', () => {
    const cids = referencedCids(OUTLOOK_HTML);
    expect([...cids]).toEqual(['image001.png@01dd782e.c3317510', 'logo2@x']);
  });

  it('shows addresses like Outlook and formats the Sent line', () => {
    expect(displayAddress('"processingsupport" <ps@example.com>')).toBe('processingsupport <ps@example.com>');
    expect(formatSent(new Date('2026-11-20T17:20:56Z'), 'America/New_York')).toBe('Friday, November 20, 2026 12:20 PM');
  });

  it('builds new message + Outlook header + the original formatted body, with escaping, for a 130 KB thread', () => {
    const { html, text } = buildQuotedReply({
      newHtml: '<p>Hi Matthew,</p>',
      newText: 'Hi Matthew,',
      timeZone: 'America/New_York',
      original: {
        from: '"processingsupport" <ps@example.com>',
        to: ['Andres <a@example.com>', 'me@example.com'],
        cc: ['Evan <e@example.com>'],
        date: new Date('2026-11-20T17:20:56Z'),
        subject: 'Re: <script> & $1.00',
        html: OUTLOOK_HTML,
        text: 'Hey Stavros,',
      },
    });
    expect(html.indexOf('<p>Hi Matthew,</p>')).toBeLessThan(html.indexOf('<b>From:</b>'));
    expect(html).toContain('<b>From:</b> processingsupport &lt;ps@example.com&gt;');
    expect(html).toContain('<b>Cc:</b> Evan &lt;e@example.com&gt;');
    expect(html).toContain('<b>Subject:</b> Re: &lt;script&gt; &amp; $1.00');
    expect(html).toContain('<ol><li>One</li><li>Two</li></ol>');
    expect(html).toContain('href="https://form.example/agent"');
    expect(html).toContain('src="cid:image001.png@01DD782E.C3317510"');
    expect(html).toContain('p.MsoNormal');
    expect(html.length).toBeGreaterThan(130_000);
    expect(text).toMatch(/^Hi Matthew,\n\n_{32}\nFrom: processingsupport <ps@example.com>\nSent: Friday, November 20, 2026 12:20 PM\nTo: Andres <a@example.com>; me@example.com\nCc: Evan <e@example.com>\nSubject: Re: <script> & \$1\.00\n\nHey Stavros,$/);
  });

  it('quotes a plain-text original safely when it has no HTML', () => {
    const { html } = buildQuotedReply({ newText: 'Thanks', original: { from: 'a@x.com', to: ['b@x.com'], subject: 'S', text: '<b>not html</b>' } });
    expect(html).toContain('&lt;b&gt;not html&lt;/b&gt;');
    expect(html).not.toContain('<b>not html</b>');
  });
});

describe('imap_save_reply_draft', () => {
  const handlers: Record<string, Function> = {};
  const mockServer = { registerTool: vi.fn((name: string, _s: any, h: Function) => { handlers[name] = h; }) };
  const account: any = { id: 'acc1', email: 'me@example.com', user: 'me@example.com', saveToSent: false };
  const originalEmail = {
    from: '"processingsupport" <ps@example.com>',
    to: ['ps@example.com', 'Andres <a@example.com>', 'me@example.com'],
    cc: ['Evan <e@example.com>'],
    subject: 'Re: [SoftTouch] webhook',
    messageId: '<orig@example.com>',
    references: ['<first@example.com>'],
    date: new Date('2026-11-20T17:20:56Z'),
    textContent: 'Hey Stavros,',
  };
  const mockImapService = {
    getEmailContent: vi.fn(async () => originalEmail),
    getReplyQuoteSource: vi.fn(async () => ({
      html: OUTLOOK_HTML,
      text: 'Hey Stavros,',
      date: new Date('2026-11-20T17:20:56Z'),
      inline: [
        { cid: 'image001.png@01DD782E.C3317510', content: Buffer.from('png1'), contentType: 'image/png', filename: 'image001.png' },
        { cid: 'logo2@x', content: Buffer.from('png2'), contentType: 'image/png', filename: 'logo2.png' },
        { cid: 'unused@x', content: Buffer.from('zip'), contentType: 'application/zip', filename: 'report.zip' },
      ],
    })),
    findDraftsFolder: vi.fn(async () => 'Drafts'),
    appendMessage: vi.fn(async () => true),
  };
  const mockSmtpService = { composeRaw: vi.fn(async () => Buffer.from('raw')), sendEmail: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(mockServer as any, mockImapService as any,
      { resolveAccountId: (id: string) => id, getAccount: vi.fn(async () => account) } as any, mockSmtpService as any);
  });

  it('saves a reply-all draft with the quoted thread and re-attached inline images, and never sends', async () => {
    const res = await handlers.imap_save_reply_draft({
      accountId: 'acc1', folder: 'INBOX', uid: 7182, replyAll: true, quoteOriginal: true,
      html: '<p>Hi Matthew,</p>', text: 'Hi Matthew,', timeZone: 'America/New_York',
    });
    const c = mockSmtpService.composeRaw.mock.calls.at(-1)?.[1];
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
    expect(mockImapService.appendMessage).toHaveBeenCalledWith('acc1', 'Drafts', expect.anything(), ['\\Draft', '\\Seen']);
    expect(c.to).toEqual(['"processingsupport" <ps@example.com>', 'Andres <a@example.com>']);
    expect(c.cc).toEqual(['Evan <e@example.com>']);
    expect(c.subject).toBe('Re: [SoftTouch] webhook');
    expect(c.inReplyTo).toBe('<orig@example.com>');
    expect(c.html).toContain('<b>Sent:</b> Friday, November 20, 2026 12:20 PM');
    expect(c.html.length).toBeGreaterThan(130_000);
    expect(c.attachments.map((a: any) => [a.cid, a.contentDisposition])).toEqual([
      ['image001.png@01DD782E.C3317510', 'inline'], ['logo2@x', 'inline'],
    ]);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ success: true, inlineImages: 2, quoted: true });
  });

  it('adds "RE:" to a subject without one, and can skip the quote', async () => {
    mockImapService.getEmailContent.mockResolvedValueOnce({ ...originalEmail, subject: 'Question' });
    await handlers.imap_save_reply_draft({ accountId: 'acc1', folder: 'INBOX', uid: 1, replyAll: false, quoteOriginal: false, text: 'Hi' });
    const c = mockSmtpService.composeRaw.mock.calls.at(-1)?.[1];
    expect(c.subject).toBe('RE: Question');
    expect(c.to).toEqual(['"processingsupport" <ps@example.com>']);
    expect(c.html).toBeUndefined();
    expect(mockImapService.getReplyQuoteSource).not.toHaveBeenCalled();
  });

  it('refuses an empty reply', async () => {
    await expect(handlers.imap_save_reply_draft({ accountId: 'acc1', folder: 'INBOX', uid: 1, replyAll: true, quoteOriginal: true }))
      .rejects.toThrow('Pass html and/or text');
  });
});

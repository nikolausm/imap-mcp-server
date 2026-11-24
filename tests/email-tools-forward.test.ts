import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4-mini';
import { simpleParser, type ParsedMail } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { emailTools } from '../src/tools/email-tools.js';
import { ImapService } from '../src/services/imap-service.js';
import { SmtpService } from '../src/services/smtp-service.js';
import {
  FORWARD_SOURCE_MAX_BYTES,
  forwardAttachments,
  prependForwardHtml,
  referencedCids,
} from '../src/utils/forward-content.js';

/**
 * imap_forward_email accepted includeAttachments (default true) but never
 * attached anything, and the note plus the "Forwarded message" header only
 * reached the text/plain part, not the HTML part clients display (#238).
 *
 * These tests run the registered handler against a real ImapService (only the
 * IMAP client is stubbed and serves raw RFC 822 fixtures) and a real
 * SmtpService (only the transport is stubbed). The checks parse the MIME that
 * was handed to the transport and the Sent copy that reached IMAP APPEND, so
 * they cover composition and parsing, not just the composer object.
 */

// Real mailparser throughout; wrapped only so one test can hand the service a
// parse result with an unreadable part.
vi.mock('mailparser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mailparser')>();
  return { ...actual, simpleParser: vi.fn(actual.simpleParser) };
});

const PDF_REPORT = Buffer.from('%PDF-1.4\n% report fixture\n');
const PDF_SCAN = Buffer.from('%PDF-1.7\n% scan fixture with Content-ID\n');
const PNG_LOGO = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');

const b64 = (bytes: Buffer) => bytes.toString('base64');
const mime = (...lines: string[]) => Buffer.from(lines.join('\r\n'));

const headers = (subject: string, from = 'Alice <alice@example.org>') => [
  `From: ${from}`,
  'To: Me <me@example.com>',
  `Subject: ${subject}`,
  'Date: Mon, 02 Nov 2026 10:00:00 +0000',
  'Message-ID: <orig-1@example.org>',
  'MIME-Version: 1.0',
];

const reportPdfPart = [
  'Content-Type: application/pdf; name="report.pdf"',
  'Content-Disposition: attachment; filename="report.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  b64(PDF_REPORT),
];

// text + HTML alternative, the HTML with an inline CID image in
// multipart/related, a regular PDF, and a PDF that carries a Content-ID.
const mixedOriginal = mime(
  ...headers('Quarterly report'),
  'Content-Type: multipart/mixed; boundary="mixed"',
  '',
  '--mixed',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Report attached.',
  '--alt',
  'Content-Type: multipart/related; boundary="rel"',
  '',
  '--rel',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Report attached. <img src="cid:logo1"></p>',
  '--rel',
  'Content-Type: image/png',
  'Content-ID: <logo1>',
  'Content-Disposition: inline; filename="logo.png"',
  'Content-Transfer-Encoding: base64',
  '',
  b64(PNG_LOGO),
  '--rel--',
  '--alt--',
  '--mixed',
  ...reportPdfPart,
  '--mixed',
  'Content-Type: application/pdf; name="scan.pdf"',
  'Content-ID: <scan1@example.org>',
  'Content-Disposition: attachment; filename="scan.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  b64(PDF_SCAN),
  '--mixed--',
  '',
);

const htmlOnlyOriginal = mime(
  ...headers('HTML only'),
  'Content-Type: multipart/mixed; boundary="mixed"',
  '',
  '--mixed',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Only <b>HTML</b> here.</p>',
  '--mixed',
  ...reportPdfPart,
  '--mixed--',
  '',
);

const textOnlyOriginal = mime(
  ...headers('Plain text'),
  'Content-Type: multipart/mixed; boundary="mixed"',
  '',
  '--mixed',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Just text.',
  '--mixed',
  ...reportPdfPart,
  '--mixed--',
  '',
);

const fullDocumentOriginal = mime(
  ...headers('Newsletter'),
  'Content-Type: text/html; charset=utf-8',
  '',
  '<!DOCTYPE html><html><head><title>News</title><style>p { color: red; }</style></head>' +
    '<body class="mail" style="margin:0"><p>Hello reader</p></body></html>',
  '',
);

const markupOriginal = mime(
  ...headers('<script>alert(1)</script> & co', "Pat O'Brien <pat@example.org>"),
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Body text.',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Body text.</p>',
  '--alt--',
  '',
);

// multipart/mixed with a text part before an HTML document: mailparser joins
// both into one HTML string, the text first.
const textThenDocumentOriginal = mime(
  ...headers('Text then document'),
  'Content-Type: multipart/mixed; boundary="mixed"',
  '',
  '--mixed',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'First plain part.',
  '--mixed',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<!DOCTYPE html><html><head></head><body><p>Html part</p></body></html>',
  '--mixed--',
  '',
);

const LATIN1_TEXT = Buffer.from('Gr\xfc\xdfe aus K\xf6ln\n', 'latin1');
const ICS = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR';

// Parts whose Content-Type parameters matter: a Latin-1 text file and a
// calendar invitation.
const paramsOriginal = mime(
  ...headers('Invitation'),
  'Content-Type: multipart/mixed; boundary="mixed"',
  '',
  '--mixed',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'See the invitation.',
  '--mixed',
  'Content-Type: text/plain; charset=iso-8859-1; name="gruss.txt"',
  'Content-Disposition: attachment; filename="gruss.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  b64(LATIN1_TEXT),
  '--mixed',
  'Content-Type: text/calendar; method=REQUEST; charset=utf-8; name="invite.ics"',
  'Content-Disposition: attachment; filename="invite.ics"',
  '',
  ICS,
  '--mixed--',
  '',
);

// About 1 MiB of "<body" with no ">": a backtracking search for the body tag
// takes quadratic time on this and blocks the whole server.
const BODY_FLOOD = '<p>x</p>' + '<body'.repeat(200 * 1024);
const floodOriginal = mime(
  ...headers('Crafted'),
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'plain',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  '',
  BODY_FLOOD,
  '--alt--',
  '',
);

const account: any = {
  id: 'acc1',
  name: 'Test',
  host: 'imap.example.com',
  port: 993,
  user: 'me@example.com',
  password: 'pw',
  tls: true,
  email: 'me@example.com',
  defaultBcc: 'archive@example.com',
  // Set, so the Sent copy goes straight to APPEND without a folder LIST.
  sentFolder: 'Sent',
};

type FetchResult = { uid?: number; size?: number; flags?: Set<string>; source?: Buffer } | null;

function setup(fetchResult: FetchResult | (() => Promise<FetchResult>)) {
  const client = {
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    fetchOne: vi.fn(typeof fetchResult === 'function' ? fetchResult : async () => fetchResult),
    append: vi.fn(async () => ({ destination: 'Sent' })),
  };
  const imapService = new ImapService();
  // ensureConnected is private; stub it so the service runs against the fake client.
  (imapService as any).ensureConnected = vi.fn(async () => client);

  const smtpService = new SmtpService();
  const sendMail = vi.fn(async (options: any) => ({ messageId: options.messageId }));
  vi.spyOn(smtpService, 'createTransporter').mockResolvedValue({ sendMail } as any);

  let handler!: Function;
  let inputSchema: any;
  const server = {
    registerTool: vi.fn((name: string, config: any, registered: Function) => {
      if (name === 'imap_forward_email') {
        handler = registered;
        inputSchema = config.inputSchema;
      }
    }),
  };
  const accountManager = { resolveAccountId: (id: string) => id, getAccount: vi.fn(async () => account) };
  emailTools(server as any, imapService, accountManager as any, smtpService);

  const forward = async (args: Record<string, unknown> = {}) => {
    const result = await handler({ accountId: 'acc1', folder: 'INBOX', uid: 42, to: 'bob@example.net', ...args });
    return JSON.parse(result.content[0].text);
  };

  // Both MIME versions of the forward: what the SMTP transport would deliver
  // (nodemailer composes the sendMail options the same way) and the Sent copy
  // as it reached IMAP APPEND. keepCidLinks so cid: references stay visible.
  const forwardedMessages = async (): Promise<ParsedMail[]> => {
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(client.append).toHaveBeenCalledTimes(1);
    const delivered = await new MailComposer(sendMail.mock.calls[0][0]).compile().build();
    const sentCopy = client.append.mock.calls[0][1] as Buffer;
    return Promise.all([delivered, sentCopy].map(raw => simpleParser(raw, { keepCidLinks: true })));
  };

  return { client, sendMail, forward, forwardedMessages, inputSchema: () => inputSchema };
}

const found = (source: Buffer): FetchResult => ({ uid: 42, size: source.length, flags: new Set(['\\Seen']), source });
const byName = (mail: ParsedMail, filename: string) => mail.attachments.find(a => a.filename === filename);
const htmlOf = (mail: ParsedMail) => (typeof mail.html === 'string' ? mail.html : '');

describe('imap_forward_email MIME round trip (#238)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includeAttachments: true forwards both PDFs as attachments and the CID image inline', async () => {
    const { client, forward, forwardedMessages } = setup(found(mixedOriginal));
    await forward({ includeAttachments: true, text: 'See below.' });

    // Bounded read: one byte over the limit, so an oversized message is noticed without a full download.
    expect(client.fetchOne).toHaveBeenCalledWith(
      42,
      { size: true, flags: true, source: { maxLength: FORWARD_SOURCE_MAX_BYTES + 1 } },
      { uid: true },
    );

    for (const mail of await forwardedMessages()) {
      expect(mail.attachments.map(a => a.filename).sort()).toEqual(['logo.png', 'report.pdf', 'scan.pdf']);

      for (const [name, bytes] of [['report.pdf', PDF_REPORT], ['scan.pdf', PDF_SCAN]] as const) {
        const pdf = byName(mail, name)!;
        expect(pdf.contentType).toBe('application/pdf');
        expect(pdf.contentDisposition).toBe('attachment');
        // Not in multipart/related, so clients list it; the original Content-ID of scan.pdf is dropped.
        expect(pdf.related).toBeFalsy();
        expect(pdf.cid).toBeUndefined();
        expect(pdf.content.equals(bytes)).toBe(true);
      }

      const logo = byName(mail, 'logo.png')!;
      expect(logo.contentType).toBe('image/png');
      expect(logo.contentDisposition).toBe('inline');
      expect(logo.related).toBe(true);
      expect(logo.cid).toBe('logo1');
      expect(logo.content.equals(PNG_LOGO)).toBe(true);

      const html = htmlOf(mail);
      expect(html).toContain('<img src="cid:logo1">');
      expect(html.startsWith('<div>See below.<br>')).toBe(true);
      expect(html.indexOf('---------- Forwarded message ----------')).toBeLessThan(html.indexOf('<p>Report attached.'));
      expect(html).toContain('From: &quot;Alice&quot; &lt;alice@example.org&gt;');

      expect(mail.text).toContain('See below.');
      expect(mail.text).toContain('---------- Forwarded message ----------');
      expect(mail.text).toContain('Report attached.');
    }
  });

  it('treats an omitted includeAttachments like the schema default (true)', async () => {
    const { forward, forwardedMessages } = setup(found(mixedOriginal));
    await forward();

    for (const mail of await forwardedMessages()) {
      expect(mail.attachments.map(a => a.filename).sort()).toEqual(['logo.png', 'report.pdf', 'scan.pdf']);
    }
  });

  it('includeAttachments: false attaches no MIME part; the referenced image stays a data: URL as before', async () => {
    const { client, forward, forwardedMessages } = setup(found(mixedOriginal));
    await forward({ includeAttachments: false, text: 'FYI' });

    // Same read as before the fix (getEmailContent).
    expect(client.fetchOne).toHaveBeenCalledTimes(1);
    expect(client.fetchOne).toHaveBeenCalledWith(42, { source: true, flags: true }, { uid: true });

    for (const mail of await forwardedMessages()) {
      expect(mail.attachments).toEqual([]);
      const html = htmlOf(mail);
      expect(html.startsWith('<div>FYI<br>')).toBe(true);
      expect(html).toContain('---------- Forwarded message ----------');
      // Unchanged HTML handling: mailparser renders the cid: image as a data: URL, no part is attached.
      expect(html).not.toContain('cid:logo1');
      expect(html).toContain(`src="data:image/png;base64,${b64(PNG_LOGO)}"`);
      expect(mail.text).toContain('FYI');
    }
  });

  it('forwards an HTML-only original with note and header in both parts', async () => {
    const { forward, forwardedMessages } = setup(found(htmlOnlyOriginal));
    await forward({ text: 'HTML only original.' });

    for (const mail of await forwardedMessages()) {
      const html = htmlOf(mail);
      expect(html.startsWith('<div>HTML only original.<br>')).toBe(true);
      expect(html).toContain('<p>Only <b>HTML</b> here.</p>');
      // text/plain part: note and header. (mailparser derives a text body from the
      // HTML only for single-part HTML messages; see the full-document test.)
      expect(mail.text).toContain('HTML only original.');
      expect(mail.text).toContain('---------- Forwarded message ----------');
      expect(mail.attachments.map(a => a.filename)).toEqual(['report.pdf']);
      expect(byName(mail, 'report.pdf')!.content.equals(PDF_REPORT)).toBe(true);
    }
  });

  it('adds no HTML part when the original is plain text', async () => {
    const { forward, forwardedMessages } = setup(found(textOnlyOriginal));
    await forward({ text: 'Text only original.' });

    for (const mail of await forwardedMessages()) {
      expect(mail.html).toBeFalsy();
      expect(mail.text).toContain('Text only original.');
      expect(mail.text).toContain('Just text.');
      expect(mail.attachments.map(a => a.filename)).toEqual(['report.pdf']);
    }
  });

  // The HTML comes from different parse paths for true and false, so the HTML
  // placement and escaping run for both settings.
  it.each([true, false])('puts the block right after <body> of a full HTML document (includeAttachments: %s)', async (includeAttachments) => {
    const { forward, forwardedMessages } = setup(found(fullDocumentOriginal));
    await forward({ includeAttachments, text: 'Document original.' });

    for (const mail of await forwardedMessages()) {
      const html = htmlOf(mail);
      expect(html.startsWith('<!DOCTYPE html><html><head><title>News</title>')).toBe(true);
      expect(html).toContain('<body class="mail" style="margin:0"><div>Document original.<br>');
      expect(html.indexOf('---------- Forwarded message ----------')).toBeLessThan(html.indexOf('<p>Hello reader</p>'));
      // Single-part HTML original: the text part carries the text derived from it.
      expect(mail.text).toContain('Document original.');
      expect(mail.text).toContain('Hello reader');
    }
  });

  it.each([true, false])('puts the block at the start of an HTML fragment (includeAttachments: %s)', async (includeAttachments) => {
    const { forward, forwardedMessages } = setup(found(markupOriginal));
    await forward({ includeAttachments, text: 'Fragment original.' });

    for (const mail of await forwardedMessages()) {
      const html = htmlOf(mail);
      expect(html.startsWith('<div>Fragment original.<br>')).toBe(true);
      expect(html).toContain('</div><br>');
      expect(html.trimEnd().endsWith('<p>Body text.</p>')).toBe(true);
    }
  });

  it.each([true, false])('puts the block before a text part that precedes an HTML document (includeAttachments: %s)', async (includeAttachments) => {
    const { forward, forwardedMessages } = setup(found(textThenDocumentOriginal));
    await forward({ includeAttachments, text: 'Mixed original.' });

    for (const mail of await forwardedMessages()) {
      const html = htmlOf(mail);
      expect(html.startsWith('<div>Mixed original.<br>')).toBe(true);
      expect(html.indexOf('---------- Forwarded message ----------')).toBeLessThan(html.indexOf('First plain part.'));
      expect(html).toContain('<body><p>Html part</p></body>');
    }
  });

  it('keeps the charset and method parameters of forwarded parts', async () => {
    const { forward, forwardedMessages } = setup(found(paramsOriginal));
    await forward({ text: 'Invitation below.' });

    for (const mail of await forwardedMessages()) {
      const params = (name: string) => (byName(mail, name)!.headers.get('content-type') as any).params;
      expect(byName(mail, 'gruss.txt')!.contentType).toBe('text/plain');
      expect(params('gruss.txt').charset).toBe('iso-8859-1');
      expect(byName(mail, 'gruss.txt')!.content.equals(LATIN1_TEXT)).toBe(true);
      expect(byName(mail, 'invite.ics')!.contentType).toBe('text/calendar');
      expect(params('invite.ics').method).toBe('REQUEST');
      expect(params('invite.ics').charset).toBe('utf-8');
      expect(byName(mail, 'invite.ics')!.content.toString()).toBe(ICS);
    }
  });

  it.each([true, false])('handles about 1 MiB of "<body" without ">" in linear time (includeAttachments: %s)', async (includeAttachments) => {
    const { forward, forwardedMessages } = setup(found(floodOriginal));
    const started = performance.now();
    await forward({ includeAttachments, text: 'Flood.' });
    // Linear: well under the limit. A quadratic search on this input takes minutes.
    expect(performance.now() - started).toBeLessThan(2000);

    const [delivered] = await forwardedMessages();
    expect(htmlOf(delivered).startsWith('<div>Flood.<br>')).toBe(true);
  });

  it.each([true, false])('escapes the note and the header fields in the HTML part, not in the text part (includeAttachments: %s)', async (includeAttachments) => {
    const { forward, forwardedMessages } = setup(found(markupOriginal));
    const note = 'Look at <b>this</b> & "that"';
    await forward({ includeAttachments, text: note });

    for (const mail of await forwardedMessages()) {
      const html = htmlOf(mail);
      expect(html).toContain('Look at &lt;b&gt;this&lt;/b&gt; &amp; &quot;that&quot;');
      expect(html).toContain('From: &quot;Pat O&#39;Brien&quot; &lt;pat@example.org&gt;');
      expect(html).toContain('Subject: &lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<b>this</b>');

      expect(mail.text).toContain(note);
      expect(mail.text).toContain('Subject: <script>alert(1)</script> & co');
    }
  });

  it('keeps recipients, From, default BCC, subject, References and the Sent copy unchanged', async () => {
    const { client, sendMail, forward, forwardedMessages } = setup(found(mixedOriginal));
    const response = await forward({ to: ['bob@example.net', 'carol@example.net'], bcc: 'extra@example.net' });

    expect(Object.keys(response).sort()).toEqual(['message', 'messageId', 'savedToSent', 'sentFolder', 'success']);
    expect(response).toMatchObject({ success: true, savedToSent: true, sentFolder: 'Sent' });
    expect(response.message).toBe('Email forwarded successfully (saved to "Sent")');

    const options = sendMail.mock.calls[0][0];
    expect(options.from).toBe('me@example.com');
    expect(options.to).toEqual(['bob@example.net', 'carol@example.net']);
    expect(options.bcc).toEqual(['extra@example.net', 'archive@example.com']);
    expect(options.subject).toBe('Fwd: Quarterly report');
    expect(options.references).toBe('<orig-1@example.org>');
    expect(client.append).toHaveBeenCalledWith('Sent', expect.any(Buffer), ['\\Seen']);

    const [, sentCopy] = await forwardedMessages();
    expect(sentCopy.messageId).toBe(response.messageId);
    expect(sentCopy.subject).toBe('Fwd: Quarterly report');
    // The Sent copy keeps Bcc (keepBcc), including the account default.
    expect(sentCopy.bcc && !Array.isArray(sentCopy.bcc) ? sentCopy.bcc.text : '').toBe('extra@example.net, archive@example.com');
  });
});

describe('imap_forward_email fails before sending when an attachment cannot be fetched', () => {
  beforeEach(() => vi.clearAllMocks());

  const expectNothingSent = (ctx: ReturnType<typeof setup>) => {
    expect(ctx.sendMail).not.toHaveBeenCalled();
    expect(ctx.client.append).not.toHaveBeenCalled();
  };

  it('when the message is gone', async () => {
    const ctx = setup(null);
    await expect(ctx.forward({ includeAttachments: true })).rejects.toThrow('Email with UID 42 not found');
    expectNothingSent(ctx);
  });

  it('when the IMAP fetch fails', async () => {
    const ctx = setup(async () => { throw new Error('Connection not available'); });
    await expect(ctx.forward({ includeAttachments: true })).rejects.toThrow('Connection not available');
    expectNothingSent(ctx);
  });

  it('when the message is larger than the bound, without parsing the truncated source', async () => {
    const ctx = setup({ uid: 42, size: FORWARD_SOURCE_MAX_BYTES + 1, flags: new Set(), source: mixedOriginal });
    await expect(ctx.forward({ includeAttachments: true }))
      .rejects.toThrow(`over the ${FORWARD_SOURCE_MAX_BYTES}-byte limit for forwarding it with its attachments; the email was not forwarded`);
    expect(simpleParser).not.toHaveBeenCalled();
    expectNothingSent(ctx);
  });

  it('when a part has no readable content', async () => {
    const { simpleParser: realParser } = await vi.importActual<typeof import('mailparser')>('mailparser');
    vi.mocked(simpleParser).mockImplementationOnce((async (source: Buffer, options: any) => {
      const parsed = await realParser(source, options);
      (parsed.attachments.find(a => a.filename === 'report.pdf') as any).content = undefined;
      return parsed;
    }) as any);

    const ctx = setup(found(mixedOriginal));
    await expect(ctx.forward({ includeAttachments: true }))
      .rejects.toThrow('Attachment "report.pdf" of email UID 42 could not be read; the email was not forwarded.');
    expectNothingSent(ctx);
  });
});

describe('ImapService.getEmailForForward bounded read', () => {
  const serviceWith = (fetched: FetchResult) => {
    const release = vi.fn();
    const client = {
      getMailboxLock: vi.fn(async () => ({ release })),
      fetchOne: vi.fn(async () => fetched),
    };
    const service = new ImapService();
    (service as any).ensureConnected = vi.fn(async () => client);
    return { service, client, release };
  };

  it('rejects a source longer than the bound even when the server sends no RFC822.SIZE', async () => {
    const { service, client, release } = serviceWith({ uid: 42, source: Buffer.alloc(101, 0x41) });
    await expect(service.getEmailForForward('acc1', 'INBOX', 42, 100))
      .rejects.toThrow('Email UID 42 is more than 100 bytes, over the 100-byte limit');
    expect(client.fetchOne).toHaveBeenCalledWith(42, { size: true, flags: true, source: { maxLength: 101 } }, { uid: true });
    expect(release).toHaveBeenCalled();
  });

  it('does not repeat an under-reported RFC822.SIZE as the size', async () => {
    const { service } = serviceWith({ uid: 42, size: 50, source: Buffer.alloc(101, 0x41) });
    await expect(service.getEmailForForward('acc1', 'INBOX', 42, 100))
      .rejects.toThrow('Email UID 42 is more than 100 bytes, over the 100-byte limit');
  });

  it('accepts a message exactly at the bound', async () => {
    const { service } = serviceWith(found(textOnlyOriginal));
    const { email, attachments } = await service.getEmailForForward('acc1', 'INBOX', 42, textOnlyOriginal.length);
    expect(email.subject).toBe('Plain text');
    expect(attachments.map(a => a.filename)).toEqual(['report.pdf']);
  });
});

describe('forward helpers', () => {
  it('referencedCids matches cid: references exactly', () => {
    expect([...referencedCids('<img src="cid:logo10"><img src=\'cid:a@b\'>')]).toEqual(['logo10', 'a@b']);
    expect(referencedCids(undefined).size).toBe(0);
  });

  it('referencedCids finds upper-case, unquoted and CSS url() references', () => {
    const html = '<img src="CID:upper1"> <img src=cid:unq1> <div style="background:url(cid:bg1)"></div>';
    expect([...referencedCids(html)]).toEqual(['upper1', 'unq1', 'bg1']);
  });

  it('embeds only images the HTML references, and drops the cid of everything else', () => {
    const png = { contentType: 'image/png', content: Buffer.from('png') };
    const result = forwardAttachments([
      { ...png, filename: 'logo1.png', cid: 'logo1' },
      { ...png, filename: 'logo10.png', cid: 'logo10' },
      { filename: 'chart.svg', contentType: 'image/svg+xml', cid: 'chart', content: Buffer.from('<svg/>') },
      { filename: 'scan.pdf', contentType: 'application/pdf', cid: 'scan', content: Buffer.from('pdf') },
      { contentType: 'image/png', content: Buffer.from('unnamed') },
    ], '<img src="cid:logo10"><img src="cid:chart"><a href="cid:scan">scan</a>', 7);

    expect(result.map(a => [a.filename, a.contentDisposition, a.cid])).toEqual([
      // cid:logo10 must not count as a reference to logo1
      ['logo1.png', 'attachment', undefined],
      ['logo10.png', 'inline', 'logo10'],
      ['chart.svg', 'inline', 'chart'],
      // referenced, but not an image: stays a listed attachment outside multipart/related
      ['scan.pdf', 'attachment', undefined],
      // no name: nodemailer generates one
      ['', 'attachment', undefined],
    ]);
  });

  it('throws for a part without content instead of dropping it', () => {
    expect(() => forwardAttachments([{ contentType: 'application/pdf' }], undefined, 9))
      .toThrow('Attachment #1 of email UID 9 could not be read; the email was not forwarded.');
  });

  it('prependForwardHtml handles fragments, documents and missing HTML', () => {
    const prefix = 'Note & more\n\n---------- Forwarded message ----------\nFrom: A <a@example.org>\n\n';
    const block = '<div>Note &amp; more<br>\n<br>\n---------- Forwarded message ----------<br>\nFrom: A &lt;a@example.org&gt;</div><br>\n';

    expect(prependForwardHtml('<p>x</p>', prefix)).toBe(`${block}<p>x</p>`);
    expect(prependForwardHtml('<HTML><HEAD></HEAD><BODY bgcolor="#fff"><p>x</p></BODY></HTML>', prefix))
      .toBe(`<HTML><HEAD></HEAD><BODY bgcolor="#fff">${block}<p>x</p></BODY></HTML>`);
    expect(prependForwardHtml(undefined, prefix)).toBeUndefined();
    expect(prependForwardHtml('<p>x</p>', '\n\n')).toBe('<p>x</p>');
  });

  describe('prependForwardHtml places the block before the first visible content despite comments, raw-text elements and quoted attributes', () => {
    const B = '<div>Note</div><br>\n';
    const put = (html: string) => prependForwardHtml(html, 'Note');

    it.each([
      ['a "<body>" in a comment of a fragment', '<p>visible</p><!-- <body> -->', `${B}<p>visible</p><!-- <body> -->`],
      ['a "<body>" in <title>', '<html><head><title>The <body> tag</title></head><body><p>x</p></body></html>',
        `<html><head><title>The <body> tag</title></head><body>${B}<p>x</p></body></html>`],
      ['a ">" in a quoted body attribute', '<html><body onload="if(a>b)x()"><p>x</p></body></html>',
        `<html><body onload="if(a>b)x()">${B}<p>x</p></body></html>`],
      ['a document without <body>', '<!DOCTYPE html><html><head><title>t</title></head><p>x</p></html>',
        `<!DOCTYPE html><html><head><title>t</title></head>${B}<p>x</p></html>`],
      ['head content, comments and whitespace before <body>',
        '<?xml version="1.0"?>\n<!DOCTYPE html>\n<HTML lang="de">\n<head><meta charset="utf-8"><style>p{}</style><script>var b = "<body>";</script></head>\n<!-- x -->\n<Body\n class="m">x',
        `<?xml version="1.0"?>\n<!DOCTYPE html>\n<HTML lang="de">\n<head><meta charset="utf-8"><style>p{}</style><script>var b = "<body>";</script></head>\n<!-- x -->\n<Body\n class="m">${B}x`],
      ['an unterminated comment', '<html><!-- open', `<html>${B}<!-- open`],
      // Comments end where browsers end them, so they cannot swallow a hidden element.
      ['the empty comment <!-->', '<!--><div hidden><!-- --></div><p>x</p>', `<!-->${B}<div hidden><!-- --></div><p>x</p>`],
      ['the empty comment <!--->', '<!---><p>visible</p><!-- -->', `<!--->${B}<p>visible</p><!-- -->`],
      ['a comment closed by --!>', '<!-- a --!><div hidden><!-- --></div><p>x</p>', `<!-- a --!>${B}<div hidden><!-- --></div><p>x</p>`],
      ['a comment closed by ---> after dashes', '<!-- a ---><p>x</p>', `<!-- a --->${B}<p>x</p>`],
      // "</titlex>" does not end <title>, so the "<body>" after it is still title text.
      ['"</titlex>" inside <title>', '<html><head><title></titlex><body></title></head><body><p>x</p></body></html>',
        `<html><head><title></titlex><body></title></head><body>${B}<p>x</p></body></html>`],
      ['"</stylex>" inside <style>', '<html><head><style></stylex><body></style></head><body><p>x</p></body></html>',
        `<html><head><style></stylex><body></style></head><body>${B}<p>x</p></body></html>`],
      ['<noscript> and <xml> in the head', '<html><head><noscript><style>.a{}</style></noscript><xml><o:x/></xml></head><body><p>x</p></body></html>',
        `<html><head><noscript><style>.a{}</style></noscript><xml><o:x/></xml></head><body>${B}<p>x</p></body></html>`],
      ['a "<body" that is not a body tag', '<bodyx><p>x</p>', `${B}<bodyx><p>x</p>`],
    ])('%s', (_name, html, expected) => {
      expect(put(html)).toBe(expected);
    });

    it.each([
      ['"<body" repeated', '<body'.repeat(200 * 1024)],
      ['"<p>x</p>" then "<body" repeated', BODY_FLOOD],
      ['"<body " repeated', '<body '.repeat(200 * 1024)],
      ['an unclosed quoted body attribute', '<body a="' + 'x'.repeat(1024 * 1024)],
      ['"<!--" repeated', '<!--'.repeat(256 * 1024)],
      ['"<title>" repeated', '<head>' + '<title>'.repeat(150 * 1024)],
      ['"</titlex" repeated inside <title>', '<head><title>' + '</titlex'.repeat(128 * 1024)],
      ['"</stylex" repeated inside <style>', '<head><style>' + '</stylex'.repeat(128 * 1024)],
      ['"--x" repeated inside a comment', '<!--' + '--x'.repeat(350 * 1024)],
      ['"--!" repeated inside a comment', '<!--' + '--!'.repeat(350 * 1024)],
      ['dashes inside a comment', '<!--' + '-'.repeat(1024 * 1024)],
    ])('finds the spot in linear time for about 1 MiB of %s', (_name, html) => {
      const started = performance.now();
      const result = put(html)!;
      expect(performance.now() - started).toBeLessThan(500);
      expect(result.length).toBe(html.length + B.length);
    });
  });
});

describe('imap_forward_email schema', () => {
  it('publishes includeAttachments unchanged: optional boolean, default true', () => {
    const { inputSchema } = setup(null);
    const json = toJSONSchema(z.object(inputSchema()), { target: 'draft-7', io: 'input' }) as any;
    expect(json.properties.includeAttachments).toEqual({
      type: 'boolean',
      default: true,
      description: 'Include original attachments',
    });
    expect(json.required ?? []).not.toContain('includeAttachments');
    expect(z.object(inputSchema()).parse({ uid: 1, to: 'a@example.org' }).includeAttachments).toBe(true);
  });
});

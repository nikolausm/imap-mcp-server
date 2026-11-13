import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';

/**
 * Handler-level tests for imap_save_reply_draft and imap_save_forward_draft.
 * Covers: actual registered handlers, IMAP-only accounts, composeRaw -> appendMessage flow,
 * no sendEmail, alias-aware self-exclusion, References, Bcc, attachment handling.
 */

let saveReplyDraftHandler: Function;
let saveForwardDraftHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_save_reply_draft') saveReplyDraftHandler = handler;
    if (name === 'imap_save_forward_draft') saveForwardDraftHandler = handler;
  }),
};

const mockOriginalEmail = {
  uid: 1,
  from: 'Alice <alice@example.org>',
  to: ['Me <me@example.com>', 'Bob <bob@example.org>'],
  cc: ['carol@example.org'],
  subject: 'Plans',
  date: new Date('2026-01-01T12:00:00Z'),
  messageId: '<m3@example.org>',
  inReplyTo: '<m2@example.org>',
  references: ['<m1@example.org>', '<m2@example.org>'],
  textContent: 'Original message',
  htmlContent: '<p>Original message</p>',
  textAsHtml: '<p>Original message</p>',
  attachments: [{ filename: 'file.pdf', contentType: 'application/pdf', size: 1000 }],
  customKeywords: [],
  flags: [],
  headers: {},
};

const mockAttachment = {
  filename: 'file.pdf',
  content: Buffer.from('pdf content'),
  contentType: 'application/pdf',
  size: 1000,
};

const imapOnlyAccount: any = {
  id: 'acc1',
  name: 'IMAP Only',
  email: 'me@example.com',
  user: 'me@example.com',
  defaultBcc: ['archive@example.com'],
  allowedFrom: ['alias@example.com'],
};

const mockImapService = {
  getEmailContentForDraft: vi.fn(async () => mockOriginalEmail),
  getEmailContent: vi.fn(async () => mockOriginalEmail),
  getAllAttachments: vi.fn(async () => [mockAttachment]),
  appendMessage: vi.fn(async () => true),
  findDraftsFolder: vi.fn(async () => 'Drafts'),
  appendToSentFolder: vi.fn(async () => ({ saved: true, folder: 'Sent' })),
};

const mockSmtpService = {
  composeRaw: vi.fn(async () => Buffer.from('RAW')),
  sendEmail: vi.fn(async () => ({ messageId: '<msg@example.com>', rawMessage: Buffer.from('RAW') })),
};

const mockAccountManager = {
  resolveAccountId: (id: string) => id,
  getAccount: vi.fn(async () => ({ ...imapOnlyAccount })),
};

function registerHandlers() {
  emailTools(
    mockServer as any,
    mockImapService as any,
    mockAccountManager as any,
    mockSmtpService as any,
  );
}

describe('imap_save_reply_draft handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerHandlers();
  });

  it('IMAP-only: composeRaw -> appendMessage, never sendEmail; self-exclusion, References, Bcc', async () => {
    const result = await saveReplyDraftHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      text: 'My reply',
      replyAll: true,
      bcc: 'extra@example.com',
    });

    // Handler invoked, IMAP-only account used
    expect(mockAccountManager.getAccount).toHaveBeenCalledWith('acc1');

    // composeRaw and appendMessage called
    expect(mockSmtpService.composeRaw).toHaveBeenCalled();
    const composeRawCall = mockSmtpService.composeRaw.mock.calls[0];
    const emailComposer = composeRawCall[1];

    // sendEmail NEVER called
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();

    // Alias-aware self-exclusion: me@example.com excluded from reply-all recipients
    expect(emailComposer.to).toEqual(['Alice <alice@example.org>', 'Bob <bob@example.org>']);
    expect(emailComposer.cc).toEqual(['carol@example.org']);

    // Array References preserved
    expect(emailComposer.references).toEqual(['<m1@example.org>', '<m2@example.org>', '<m3@example.org>']);

    // In-Reply-To set
    expect(emailComposer.inReplyTo).toBe('<m3@example.org>');

    // Bcc: explicit bcc first, then account defaultBcc (per mergeBcc)
    expect(emailComposer.bcc).toEqual(['extra@example.com', 'archive@example.com']);

    // appendMessage called with Drafts
    expect(mockImapService.appendMessage).toHaveBeenCalledWith(
      'acc1',
      'Drafts',
      expect.any(Buffer),
      ['\\Draft', '\\Seen']
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('Reply draft saved');
  });

  it('propagates appendMessage failure, still never sendEmail', async () => {
    mockImapService.appendMessage.mockResolvedValueOnce(false);

    await expect(
      saveReplyDraftHandler({
        accountId: 'acc1',
        folder: 'INBOX',
        uid: 1,
        text: 'Reply',
      })
    ).rejects.toThrow('Failed to append reply draft');

    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
  });
});

describe('imap_save_forward_draft handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerHandlers();
  });

  it('IMAP-only: composeRaw -> appendMessage, never sendEmail; Bcc; original + caller attachments merged', async () => {
    const result = await saveForwardDraftHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      to: 'friend@example.com',
      text: 'Check this out',
      bcc: 'extra@example.com',
      includeAttachments: true,
      attachments: [{ filename: 'new.txt', content: 'dmFuZ2Vy' }],
    });

    // Handler invoked
    expect(mockAccountManager.getAccount).toHaveBeenCalledWith('acc1');

    // composeRaw and appendMessage called
    expect(mockSmtpService.composeRaw).toHaveBeenCalled();

    // sendEmail NEVER called
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();

    // Original attachments fetched and merged
    expect(mockImapService.getAllAttachments).toHaveBeenCalledWith('acc1', 'INBOX', 1);

    // Bcc applied: explicit bcc first, then account defaultBcc (per mergeBcc)
    const composeRawCall = mockSmtpService.composeRaw.mock.calls[0];
    const emailComposer = composeRawCall[1];
    expect(emailComposer.bcc).toEqual(['extra@example.com', 'archive@example.com']);

    // appendMessage called with Drafts
    expect(mockImapService.appendMessage).toHaveBeenCalledWith(
      'acc1',
      'Drafts',
      expect.any(Buffer),
      ['\\Draft', '\\Seen']
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('Forward draft saved');
    expect(parsed.attachmentCount).toBe(2); // original + caller
  });

  it('skips original attachments when includeAttachments=false and handles append failure', async () => {
    mockImapService.appendMessage.mockResolvedValueOnce(false);

    await expect(
      saveForwardDraftHandler({
        accountId: 'acc1',
        folder: 'INBOX',
        uid: 1,
        to: 'friend@example.com',
        includeAttachments: false,
      })
    ).rejects.toThrow('Failed to append forward draft');

    // Original attachments NOT fetched
    expect(mockImapService.getAllAttachments).not.toHaveBeenCalled();
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();
  });
});

// Real MIME round-trip tests for content preservation using REAL parser path
// These do NOT mock getEmailContentForDraft. Instead they stub the raw fetch boundary
// (client.fetchOne) so the actual ImapService parser path runs end-to-end.
import { simpleParser } from 'mailparser';
import { SmtpService } from '../src/services/smtp-service.js';
import { ImapService } from '../src/services/imap-service.js';
import { ImapFlow } from 'imapflow';

describe('Real MIME round-trip: content preservation via real parser', () => {
  const realSmtpService = new SmtpService();
  let realSaveReplyDraftHandler: Function;
  let realSaveForwardDraftHandler: Function;

  const realMockServer = {
    registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
      if (name === 'imap_save_reply_draft') realSaveReplyDraftHandler = handler;
      if (name === 'imap_save_forward_draft') realSaveForwardDraftHandler = handler;
    }),
  };

  const realImapService = new ImapService();

  const realAccountManager = {
    resolveAccountId: (id: string) => id,
    getAccount: vi.fn(async () => ({ ...imapOnlyAccount })),
  };

  // Synthetic raw RFC822 HTML-only message source
  const htmlOnlyRawSource = Buffer.from(`MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nFrom: Alice <alice@example.org>\r\nTo: Me <me@example.com>, Bob <bob@example.org>\r\nCc: carol@example.org\r\nSubject: Test\r\nDate: Wed, 01 Jan 2026 12:00:00 +0000\r\nMessage-ID: <test@example.com>\r\nIn-Reply-To: <parent@example.com>\r\nReferences: <ref1@example.com> <ref2@example.com>\r\n\r\n<p>ORIGINAL_HTML_MARKER</p>\r\n`);

  // Mock ImapFlow client for stubbing fetch boundary
  const mockFetchClient = {
    usable: true,
    list: vi.fn(async () => [
      { path: 'INBOX', delimiter: '/', flags: [], specialUse: null },
      { path: 'Drafts', delimiter: '/', flags: ['\\Drafts'], specialUse: '\\Drafts' },
    ]),
    getMailboxLock: vi.fn(async (_folder: string) => ({
      release: vi.fn(),
    })),
    fetchOne: vi.fn(),
    append: vi.fn(async () => true),
  } as unknown as ImapFlow;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub ensureConnected to return our mock client with stubbed fetchOne
    vi.spyOn(realImapService as any, 'ensureConnected').mockResolvedValue(mockFetchClient);
    // Spy on appendMessage and getAllAttachments to track calls
    vi.spyOn(realImapService, 'appendMessage');
    vi.spyOn(realImapService, 'getAllAttachments');
    emailTools(
      realMockServer as any,
      realImapService as any,
      realAccountManager as any,
      realSmtpService as any,
    );
  });

  it('reply draft round-trip via real parser: HTML-only original survives', async () => {
    // Stub fetchOne to return synthetic HTML-only raw source
    mockFetchClient.fetchOne.mockResolvedValue({
      source: htmlOnlyRawSource,
      flags: ['\\Seen'],
    });

    await realSaveReplyDraftHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      text: 'My reply',
      replyAll: true,
      bcc: 'extra@example.com',
      from: 'alias@example.com',
      includeQuotedOriginal: true,
    });

    // Verify appendMessage was called with Drafts
    expect(realImapService.appendMessage).toHaveBeenCalled();
    const appendCall = (realImapService.appendMessage as any).mock.calls[0];
    const rawMessage = appendCall[2] as Buffer;
    const rawString = rawMessage.toString();

    // Verify HTML-only content survives through real parser path
    expect(rawString).toContain('ORIGINAL_HTML_MARKER');
    expect(rawString).toContain('My reply');

    // Verify metadata preserved
    expect(rawString).toContain('From: alias@example.com');
    expect(rawString).not.toContain('To: me@example.com');
    expect(rawString).toContain('To: Alice');
    expect(rawString).toContain('Bob');
    expect(rawString).toContain('Bcc: extra@example.com');
    expect(rawString).toContain('archive@example.com');
    expect(rawString).toContain('References: <ref1@example.com> <ref2@example.com> <test@example.com>');

    // Verify via simpleParser
    const parsed = await simpleParser(rawMessage);
    expect(parsed.text).toContain('My reply');
    expect(parsed.text).toContain('ORIGINAL_HTML_MARKER');
  });

  it('forward draft round-trip via real parser: multipart HTML + attachments', async () => {
    // Synthetic raw multipart/mixed with HTML body + attachment
    const multipartRawSource = Buffer.from(`MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="boundary123"\r\nFrom: Alice <alice@example.org>\r\nTo: Me <me@example.com>\r\nSubject: Test with attachment\r\nDate: Wed, 01 Jan 2026 12:00:00 +0000\r\nMessage-ID: <test@example.com>\r\n\r\n--boundary123\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>ORIGINAL_HTML_MARKER</p>\r\n\r\n--boundary123\r\nContent-Type: application/pdf; name="file.pdf"\r\nContent-Disposition: attachment; filename="file.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjMK\r\n--boundary123--\r\n`);

    // Stub fetchOne for multipart source - getAllAttachments will parse attachment from this
    mockFetchClient.fetchOne.mockResolvedValue({
      source: multipartRawSource,
      flags: ['\\Seen'],
    });

    await realSaveForwardDraftHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      to: 'friend@example.com',
      text: 'NEW_TEXT_MARKER',
      bcc: 'extra@example.com',
      includeQuotedOriginal: true,
      includeAttachments: true,
      attachments: [{ filename: 'new.txt', content: 'dmFuZ2Vy' }],
    });

    expect(realImapService.appendMessage).toHaveBeenCalled();
    expect(realImapService.getAllAttachments).toHaveBeenCalledWith('acc1', 'INBOX', 1);

    const appendCall = (realImapService.appendMessage as any).mock.calls[0];
    const rawMessage = appendCall[2] as Buffer;
    const rawString = rawMessage.toString();

    // Verify NEW_TEXT_MARKER appears in both text and HTML
    expect(rawString).toContain('NEW_TEXT_MARKER');
    expect(rawString).toContain('ORIGINAL_HTML_MARKER');

    // Verify via simpleParser
    const parsed = await simpleParser(rawMessage);
    expect(parsed.text).toContain('NEW_TEXT_MARKER');
    expect(parsed.text).toContain('ORIGINAL_HTML_MARKER');
    expect(parsed.html).toContain('NEW_TEXT_MARKER');

    // Verify attachments: original + caller
    expect(parsed.attachments).toHaveLength(2);
    const attachmentFilenames = parsed.attachments.map((a: any) => a.filename).sort();
    expect(attachmentFilenames).toEqual(['file.pdf', 'new.txt']);

    // Bcc should include both explicit and default
    expect(rawString).toContain('Bcc: extra@example.com');
    expect(rawString).toContain('archive@example.com');
  });
});

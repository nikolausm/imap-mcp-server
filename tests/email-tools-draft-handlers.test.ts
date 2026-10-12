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

// Real MIME round-trip tests for content preservation
// These use actual composeRaw + simpleParser to verify content survives correctly
import { simpleParser } from 'mailparser';
import { SmtpService } from '../src/services/smtp-service.js';
import { ImapService } from '../src/services/imap-service.js';

describe('Real MIME round-trip: content preservation', () => {
  const realSmtpService = new SmtpService();
  let realSaveReplyDraftHandler: Function;
  let realSaveForwardDraftHandler: Function;

  const realMockServer = {
    registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
      if (name === 'imap_save_reply_draft') realSaveReplyDraftHandler = handler;
      if (name === 'imap_save_forward_draft') realSaveForwardDraftHandler = handler;
    }),
  };

  const realImapService = {
    getEmailContentForDraft: vi.fn(),
    getAllAttachments: vi.fn(async () => []),
    appendMessage: vi.fn(async () => true),
    findDraftsFolder: vi.fn(async () => 'Drafts'),
  } as unknown as ImapService;

  const realAccountManager = {
    resolveAccountId: (id: string) => id,
    getAccount: vi.fn(async () => ({ ...imapOnlyAccount })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      realMockServer as any,
      realImapService as any,
      realAccountManager as any,
      realSmtpService as any,
    );
  });

  it('reply draft round-trip: HTML-only original, Bcc, from alias, self-exclusion, References preserved', async () => {
    const testEmail = {
      uid: 1,
      from: 'Alice <alice@example.org>',
      to: ['Me <me@example.com>', 'Bob <bob@example.org>'],
      cc: ['carol@example.org'],
      subject: 'Test',
      date: new Date('2026-01-01T12:00:00Z'),
      messageId: '<test@example.com>',
      inReplyTo: '<parent@example.com>',
      references: ['<ref1@example.com>', '<ref2@example.com>'],
      textContent: undefined,
      htmlContent: '<p>ORIGINAL_HTML_MARKER</p>',
      textAsHtml: '<p>ORIGINAL_HTML_MARKER</p>',
      attachments: [],
      customKeywords: [],
      flags: [],
      headers: { 'content-type': 'text/html' },
    };
    realImapService.getEmailContentForDraft.mockResolvedValue(testEmail);

    const result = await realSaveReplyDraftHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      text: 'My reply',
      replyAll: true,
      bcc: 'extra@example.com',
      from: 'alias@example.com',
      includeQuotedOriginal: true,
    });

    expect(realImapService.appendMessage).toHaveBeenCalled();
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();

    const appendCall = realImapService.appendMessage.mock.calls[0];
    const rawMessage = appendCall[2] as Buffer;
    const rawString = rawMessage.toString();

    // Verify HTML-only content survives
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

    const parsed = await simpleParser(rawMessage);
    expect(parsed.text).toContain('My reply');
    expect(parsed.text).toContain('ORIGINAL_HTML_MARKER');
  });

  it('forward draft round-trip: multipart HTML-only + NEW_TEXT_MARKER + original + caller attachments', async () => {
    const multipartEmail = {
      uid: 1,
      from: 'Alice <alice@example.org>',
      to: ['Me <me@example.com>'],
      cc: [],
      subject: 'Test with attachment',
      date: new Date('2026-01-01T12:00:00Z'),
      messageId: '<test@example.com>',
      inReplyTo: undefined,
      references: [],
      textContent: undefined,
      htmlContent: '<p>ORIGINAL_HTML_MARKER</p>',
      textAsHtml: '<p>ORIGINAL_HTML_MARKER</p>',
      attachments: [{ filename: 'file.pdf', contentType: 'application/pdf', size: 1000 }],
      customKeywords: [],
      flags: [],
      headers: { 'content-type': 'text/html' },
    };
    const testAttachment = {
      filename: 'file.pdf',
      content: Buffer.from('test content'),
      contentType: 'application/pdf',
      size: 1000,
    };
    realImapService.getEmailContentForDraft.mockResolvedValue(multipartEmail);
    realImapService.getAllAttachments.mockResolvedValue([testAttachment]);

    const result = await realSaveForwardDraftHandler({
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
    expect(mockSmtpService.sendEmail).not.toHaveBeenCalled();

    const appendCall = realImapService.appendMessage.mock.calls[0];
    const rawMessage = appendCall[2] as Buffer;
    const rawString = rawMessage.toString();

    // Verify NEW_TEXT_MARKER appears in both text and HTML
    expect(rawString).toContain('NEW_TEXT_MARKER');
    expect(rawString).toContain('ORIGINAL_HTML_MARKER');

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

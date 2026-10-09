import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveFrom } from '../src/utils/send-as.js';
import { emailTools } from '../src/tools/email-tools.js';
import { accountTools } from '../src/tools/account-tools.js';

describe('resolveFrom', () => {
  const account: any = {
    email: 'primary@example.com',
    user: 'login@example.com',
    allowedFrom: ['Alias <alias@example.com>'],
  };

  it('uses the account email when no sender is requested', () => {
    expect(resolveFrom(account)).toBe('primary@example.com');
  });

  it('matches sender domains case-insensitively and preserves its display name', () => {
    expect(resolveFrom(account, 'Alex <alias@EXAMPLE.COM>')).toBe('Alex <alias@EXAMPLE.COM>');
  });

  it('accepts the account email and login identity without extra configuration', () => {
    expect(resolveFrom(account, 'Primary <primary@EXAMPLE.COM>')).toBe('Primary <primary@EXAMPLE.COM>');
    expect(resolveFrom(account, 'login@example.com')).toBe('login@example.com');
  });

  it('rejects a sender that is not configured for the account', () => {
    expect(() => resolveFrom(account, 'attacker@example.net')).toThrow(
      'Sender attacker@example.net is not allowed for account primary@example.com',
    );
  });

  it.each([
    'Primary <PRIMARY@EXAMPLE.COM>',
    'LOGIN@EXAMPLE.COM',
    'Alex <ALIAS@EXAMPLE.COM>',
  ])('matches the entire sender mailbox case-insensitively: %s', (from) => {
    expect(resolveFrom(account, from)).toBe(from);
  });

  it('normalizes mixed-case configured identities without changing the requested header', () => {
    const mixedCaseAccount: any = {
      email: 'Michael@X.DE',
      user: 'Login@X.DE',
      allowedFrom: ['Alias <Alias@X.DE>'],
    };
    for (const from of ['michael@x.de', 'login@x.de', 'Display Name <alias@x.de>']) {
      expect(resolveFrom(mixedCaseAccount, from)).toBe(from);
    }
  });

  it('rejects multiple mailboxes hidden in one from value', () => {
    expect(() => resolveFrom(
      account,
      'Allowed <alias@example.com>, Attacker <evil@example.net>',
    )).toThrow('Sender must contain exactly one mailbox');
  });

  it('rejects a mailbox prefixed before an allowlisted display mailbox', () => {
    expect(() => resolveFrom(
      account,
      'attacker@example.net, Allowed <alias@example.com>',
    )).toThrow('Sender must contain exactly one mailbox');
  });

  it('rejects header injection in a from value', () => {
    expect(() => resolveFrom(account, 'alias@example.com\r\nBcc: evil@example.net'))
      .toThrow('Sender must contain exactly one mailbox');
  });

  it('ignores a non-email login when validating configured sender aliases', () => {
    const usernameAccount: any = {
      email: 'primary@example.com',
      user: 'imap-login',
      allowedFrom: ['alias@example.com'],
    };
    expect(resolveFrom(usernameAccount, 'alias@example.com')).toBe('alias@example.com');
  });
});

describe('outbound email tools send-as support', () => {
  const handlers: Record<string, Function> = {};
  const schemas: Record<string, any> = {};
  const mockServer = {
    registerTool: vi.fn((name: string, schema: any, handler: Function) => {
      handlers[name] = handler;
      schemas[name] = schema.inputSchema;
    }),
  };
  const account: any = {
    id: 'acc1',
    name: 'Test',
    email: 'primary@example.com',
    user: 'login@example.com',
    allowedFrom: ['alias@example.com'],
    saveToSent: false,
  };
  const originalEmail = {
    from: 'sender@example.net',
    to: ['primary@example.com'],
    subject: 'Original',
    messageId: '<original@example.net>',
    date: new Date('2026-01-01T00:00:00Z'),
    textContent: 'Original body',
    htmlContent: '<p>Original body</p>',
  };
  const mockImapService = {
    appendToSentFolder: vi.fn(),
    findDraftsFolder: vi.fn(async () => 'Drafts'),
    appendMessage: vi.fn(async () => true),
    getEmailContent: vi.fn(async () => originalEmail),
  };
  const mockSmtpService = {
    sendEmail: vi.fn(async () => ({ messageId: '<sent@example.com>', rawMessage: Buffer.from('raw') })),
    composeRaw: vi.fn(async () => Buffer.from('raw')),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    for (const key of Object.keys(schemas)) delete schemas[key];
    emailTools(
      mockServer as any,
      mockImapService as any,
      {
        resolveAccountId: (id: string) => id,
        getAccount: vi.fn(async () => account),
      } as any,
      mockSmtpService as any,
    );
  });

  it.each(['imap_send_email', 'imap_save_draft', 'imap_reply_to_email', 'imap_forward_email'])(
    'exposes a from parameter on %s',
    (toolName) => {
      expect(schemas[toolName].from).toBeDefined();
    },
  );

  it.each([
    ['imap_send_email', { to: 'to@example.net', subject: 'Hi', text: 'Body' }],
    ['imap_save_draft', { to: 'to@example.net', subject: 'Hi', text: 'Body' }],
    ['imap_reply_to_email', { folder: 'INBOX', uid: 1, text: 'Reply' }],
    ['imap_forward_email', { folder: 'INBOX', uid: 1, to: 'to@example.net', text: 'Forward' }],
  ])('uses an allowlisted sender for %s', async (toolName, args) => {
    await handlers[toolName]({ accountId: 'acc1', from: 'Alias <alias@example.com>', ...args });

    const composer = toolName === 'imap_save_draft'
      ? mockSmtpService.composeRaw.mock.calls.at(-1)?.[1]
      : mockSmtpService.sendEmail.mock.calls.at(-1)?.[2];
    expect(composer.from).toBe('Alias <alias@example.com>');
  });

  it('excludes mixed-case own identities and aliases while preserving Reply-To and Cc', async () => {
    mockImapService.getEmailContent.mockResolvedValueOnce({
      ...originalEmail,
      replyTo: ['Help <help@example.net>'],
      to: ['PRIMARY@EXAMPLE.COM', 'ALIAS@EXAMPLE.COM', 'other@example.net'],
      cc: ['LOGIN@EXAMPLE.COM', 'Alias <ALIAS@EXAMPLE.COM>', 'other@example.net', 'cc@example.net'],
    });

    await handlers.imap_reply_to_email({
      accountId: 'acc1', folder: 'INBOX', uid: 1, text: 'Reply', replyAll: true,
    });

    const composer = mockSmtpService.sendEmail.mock.calls.at(-1)?.[2];
    expect(composer.to).toEqual(['Help <help@example.net>', 'other@example.net']);
    expect(composer.cc).toEqual(['cc@example.net']);
  });

  it('excludes configured aliases from reply-all recipients', async () => {
    mockImapService.getEmailContent.mockResolvedValueOnce({
      ...originalEmail,
      to: ['Alias <alias@example.com>', 'other@example.net'],
    });

    await handlers.imap_reply_to_email({
      accountId: 'acc1', folder: 'INBOX', uid: 1, text: 'Reply', replyAll: true,
    });

    expect(mockSmtpService.sendEmail.mock.calls.at(-1)?.[2].to).toEqual([
      'sender@example.net',
      'other@example.net',
    ]);
  });
});

describe('account tools allowedFrom configuration', () => {
  const handlers: Record<string, Function> = {};
  const mockAccountManager = {
    addAccount: vi.fn(async (value: any) => ({ id: 'acc1', ...value })),
    getAccount: vi.fn(() => ({ id: 'acc1', name: 'Test', user: 'primary@example.com' })),
    updateAccount: vi.fn(async (id: string, value: any) => ({ id, ...value })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    accountTools({
      registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
        handlers[name] = handler;
      }),
    } as any, mockAccountManager as any, {} as any, {} as any);
  });

  it('stores allowed sender aliases when adding an account', async () => {
    await handlers.imap_add_account({
      name: 'Test', host: 'imap.example.com', port: 993,
      user: 'primary@example.com', password: 'secret', tls: true,
      allowedFrom: ['alias@example.com'],
    });
    expect(mockAccountManager.addAccount).toHaveBeenCalledWith(
      expect.objectContaining({ allowedFrom: ['alias@example.com'] }),
    );
  });

  it('clears allowed sender aliases with an empty array', async () => {
    await handlers.imap_update_account({ accountId: 'acc1', allowedFrom: [] });
    expect(mockAccountManager.updateAccount).toHaveBeenCalledWith(
      'acc1', expect.objectContaining({ allowedFrom: undefined }),
    );
  });
});

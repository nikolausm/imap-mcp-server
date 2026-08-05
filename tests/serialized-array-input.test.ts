import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4-mini';
import { parseSerializedArray } from '../src/utils/array-input.js';
import { SmtpService } from '../src/services/smtp-service.js';
import { emailTools } from '../src/tools/email-tools.js';

// Issue #127: an MCP client that flattens the schema's anyOf hands the model an
// untyped field and then stringifies the array it produced. For addresses that
// used to reach nodemailer as '["a@x.com","b@y.com"]', which folds the literal
// brackets into the first and last address — every recipient bounces.

describe('parseSerializedArray', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recovers a JSON-stringified array of addresses', () => {
    expect(parseSerializedArray('["alice@example.com","bob@example.org"]', 'to'))
      .toEqual(['alice@example.com', 'bob@example.org']);
  });

  it('recovers a JSON-stringified array that keeps display names intact', () => {
    expect(parseSerializedArray('["Doe, John <j@example.com>","b@example.org"]', 'to'))
      .toEqual(['Doe, John <j@example.com>', 'b@example.org']);
  });

  it('recovers a bracketed list of bare addresses', () => {
    expect(parseSerializedArray('[alice@example.com, bob@example.org]', 'to'))
      .toEqual(['alice@example.com', 'bob@example.org']);
  });

  it('recovers a bracketed list with single quotes', () => {
    expect(parseSerializedArray("['alice@example.com', 'bob@example.org']", 'to'))
      .toEqual(['alice@example.com', 'bob@example.org']);
  });

  it('recovers a stringified array of UIDs', () => {
    expect(parseSerializedArray('[123,456]', 'uid')).toEqual([123, 456]);
  });

  it('warns on stderr without logging the addresses', () => {
    const spy = vi.spyOn(console, 'error');
    parseSerializedArray('["alice@example.com","bob@example.org"]', 'to');
    const message = spy.mock.calls[0][0] as string;
    expect(message).toContain('"to"');
    expect(message).toContain('2 item(s)');
    expect(message).not.toContain('alice@example.com');
  });

  it('leaves a real array untouched', () => {
    const input = ['alice@example.com', 'bob@example.org'];
    expect(parseSerializedArray(input, 'to')).toBe(input);
  });

  it('leaves a single address untouched', () => {
    expect(parseSerializedArray('alice@example.com', 'to')).toBe('alice@example.com');
  });

  it('leaves a comma-separated string untouched', () => {
    const input = 'Alice <alice@example.com>, Bob <bob@example.org>';
    expect(parseSerializedArray(input, 'to')).toBe(input);
  });

  it('leaves an address with a domain literal untouched', () => {
    expect(parseSerializedArray('user@[192.168.1.1]', 'to')).toBe('user@[192.168.1.1]');
  });

  it('leaves a display name that merely starts with a bracket untouched', () => {
    const input = '[Ops] Support <support@example.com>';
    expect(parseSerializedArray(input, 'to')).toBe(input);
  });

  it('leaves an empty or malformed bracket string untouched', () => {
    expect(parseSerializedArray('[]', 'to')).toBe('[]');
    expect(parseSerializedArray('[a@x.com,]', 'to')).toBe('[a@x.com,]');
  });

  it('leaves non-string input untouched', () => {
    expect(parseSerializedArray(42, 'uid')).toBe(42);
    expect(parseSerializedArray(undefined, 'cc')).toBeUndefined();
  });
});

describe('tool schemas recover stringified arrays', () => {
  const schemas = new Map<string, Record<string, z.ZodTypeAny>>();

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    schemas.clear();
    const server = {
      registerTool: vi.fn((name: string, config: any) => {
        schemas.set(name, config.inputSchema);
      }),
    };
    emailTools(server as any, {} as any, {} as any, {} as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const parseInput = (tool: string, input: Record<string, unknown>) =>
    z.object(schemas.get(tool)!).parse(input) as Record<string, unknown>;

  it('imap_send_email recovers to/cc/bcc', () => {
    const parsed = parseInput('imap_send_email', {
      to: '["alice@example.com","bob@example.org"]',
      cc: '[carol@example.net]',
      bcc: '["dave@example.com"]',
      subject: 'test',
    });
    expect(parsed.to).toEqual(['alice@example.com', 'bob@example.org']);
    expect(parsed.cc).toEqual(['carol@example.net']);
    expect(parsed.bcc).toEqual(['dave@example.com']);
  });

  it('imap_send_email still accepts the documented shapes', () => {
    expect(parseInput('imap_send_email', { to: 'alice@example.com', subject: 't' }).to)
      .toBe('alice@example.com');
    expect(parseInput('imap_send_email', { to: ['a@x.com', 'b@y.com'], subject: 't' }).to)
      .toEqual(['a@x.com', 'b@y.com']);
  });

  it('imap_forward_email and imap_save_draft recover to', () => {
    expect(parseInput('imap_forward_email', {
      folder: 'INBOX',
      uid: 1,
      to: '["alice@example.com","bob@example.org"]',
    }).to).toEqual(['alice@example.com', 'bob@example.org']);

    expect(parseInput('imap_save_draft', {
      to: '["alice@example.com"]',
      subject: 't',
    }).to).toEqual(['alice@example.com']);
  });

  it('imap_mark_as_read and imap_move_email recover uid batches', () => {
    expect(parseInput('imap_mark_as_read', { folder: 'INBOX', uid: '[123,456]' }).uid)
      .toEqual([123, 456]);
    expect(parseInput('imap_move_email', {
      folder: 'INBOX',
      uid: '[123,456]',
      targetFolder: 'Archive',
    }).uid).toEqual([123, 456]);
  });

  it('keeps rejecting input that is not a list at all', () => {
    expect(() => parseInput('imap_mark_as_read', { folder: 'INBOX', uid: 'not-a-uid' })).toThrow();
  });

  it('keeps required fields required', () => {
    expect(() => parseInput('imap_send_email', { subject: 'no recipient' })).toThrow();
    expect(() => parseInput('imap_mark_as_read', { folder: 'INBOX' })).toThrow();
  });

  // The published JSON Schema must not change: a `preprocess` takes `unknown`,
  // which silently drops the field from `required` unless `.nonoptional()` is
  // chained on. Mirrors how the MCP SDK converts a tool's input shape.
  it('publishes the same JSON Schema as a plain union', () => {
    const json = toJSONSchema(z.object(schemas.get('imap_send_email')!), {
      target: 'draft-7',
      io: 'input',
    }) as any;
    expect(json.required).toContain('to');
    expect(json.properties.to.anyOf).toEqual([
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ]);
    expect(json.properties.cc.anyOf).toEqual([
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ]);
    expect(json.required).not.toContain('cc');

    const uidJson = toJSONSchema(z.object(schemas.get('imap_mark_as_read')!), {
      target: 'draft-7',
      io: 'input',
    }) as any;
    expect(uidJson.required).toContain('uid');
    expect(uidJson.properties.uid.anyOf).toEqual([
      { type: 'number' },
      { type: 'array', items: { type: 'number' } },
    ]);
  });
});

describe('SmtpService composes a well-formed address header', () => {
  const account = {
    id: 'acc1',
    email: 'me@example.com',
    user: 'me@example.com',
  } as any;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('recovers a stringified array that reached the service directly', async () => {
    const smtp = new SmtpService();
    const raw = await smtp.composeRaw(account, {
      from: 'me@example.com',
      to: '["Alice Anderson <alice@example.com>","Bob Brown <bob@example.org>"]' as any,
      cc: '["carol@example.net"]' as any,
      subject: 'test',
      text: 'test',
    });
    const message = raw.toString();
    expect(headerOf(message, 'To'))
      .toBe('Alice Anderson <alice@example.com>, Bob Brown <bob@example.org>');
    expect(headerOf(message, 'Cc')).toBe('carol@example.net');
    // The failure mode from #127: brackets folded into the addresses.
    expect(message).not.toContain('"[');
  });

  it('composes real arrays and plain strings unchanged', async () => {
    const smtp = new SmtpService();
    const fromArray = await smtp.composeRaw(account, {
      from: 'me@example.com',
      to: ['Alice Anderson <alice@example.com>', 'Bob Brown <bob@example.org>'],
      subject: 'test',
      text: 'test',
    });
    const fromString = await smtp.composeRaw(account, {
      from: 'me@example.com',
      to: 'Alice Anderson <alice@example.com>, Bob Brown <bob@example.org>',
      subject: 'test',
      text: 'test',
    });
    const expected = 'Alice Anderson <alice@example.com>, Bob Brown <bob@example.org>';
    expect(headerOf(fromArray.toString(), 'To')).toBe(expected);
    expect(headerOf(fromString.toString(), 'To')).toBe(expected);
  });

  it('joins recovered References into a single header value', async () => {
    const smtp = new SmtpService();
    const raw = await smtp.composeRaw(account, {
      from: 'me@example.com',
      to: 'alice@example.com',
      subject: 'test',
      text: 'test',
      references: '["<a@example.com>","<b@example.com>"]' as any,
    });
    expect(headerOf(raw.toString(), 'References'))
      .toBe('<a@example.com> <b@example.com>');
  });
});

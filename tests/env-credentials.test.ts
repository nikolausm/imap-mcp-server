import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ImapAccount } from '../src/types/index.js';
import { assertCredentialsResolved, envVarName, envAccountKey } from '../src/utils/env-credentials.js';

const account = (overrides: Partial<ImapAccount> = {}): ImapAccount => ({
  id: 'acc1',
  name: 'Work Gmail',
  host: 'imap.gmail.com',
  port: 993,
  user: 'me@example.com',
  password: 'secret',
  tls: true,
  ...overrides,
} as ImapAccount);

describe('envAccountKey / envVarName', () => {
  it('uppercases and replaces every non-alphanumeric character', () => {
    expect(envAccountKey('Work Gmail')).toBe('WORK_GMAIL');
    expect(envAccountKey('mail.example.com')).toBe('MAIL_EXAMPLE_COM');
    expect(envAccountKey('Büro-2')).toBe('B_RO_2');
  });

  it('builds the documented variable name', () => {
    expect(envVarName('Work Gmail', '_IMAP_PASSWORD'))
      .toBe('IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD');
  });
});

describe('assertCredentialsResolved', () => {
  it('passes through accounts whose credentials come from accounts.json', () => {
    expect(() => assertCredentialsResolved(account(), 'imap')).not.toThrow();
    expect(() => assertCredentialsResolved(account(), 'smtp')).not.toThrow();
  });

  // The empty string is the placeholder the wizard writes for "env-managed".
  // Reaching connect() with it still empty means the variable was never set.
  it('names the missing IMAP password variable', () => {
    expect(() => assertCredentialsResolved(account({ password: '' }), 'imap'))
      .toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD/);
  });

  it('names the missing IMAP username variable', () => {
    expect(() => assertCredentialsResolved(account({ user: '' }), 'imap'))
      .toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME/);
  });

  it('lists both variables when username and password are missing', () => {
    const run = () => assertCredentialsResolved(account({ user: '', password: '' }), 'imap');
    expect(run).toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME/);
    expect(run).toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD/);
  });

  it('never puts the credential value itself in the message', () => {
    try {
      assertCredentialsResolved(account({ password: '' }), 'imap');
      throw new Error('expected assertCredentialsResolved to throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
    }
  });

  it('names the SMTP variable when the SMTP credential is the env-managed one', () => {
    const acc = account({ smtp: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'me', password: '' } } as Partial<ImapAccount>);
    expect(() => assertCredentialsResolved(acc, 'smtp'))
      .toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_PASSWORD/);
  });

  // SMTP falls back to the IMAP credentials when it has none of its own, so a
  // blank IMAP password breaks sending too — and the IMAP variable is the one
  // the user has to set.
  it('names the IMAP variable when SMTP inherits a blank IMAP credential', () => {
    const acc = account({ password: '', smtp: { host: 'smtp.gmail.com', port: 587, secure: false } } as Partial<ImapAccount>);
    expect(() => assertCredentialsResolved(acc, 'smtp'))
      .toThrow(/IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD/);
  });

  it('ignores an absent SMTP block entirely', () => {
    expect(() => assertCredentialsResolved(account({ smtp: undefined }), 'smtp')).not.toThrow();
  });

  it('does not fire on a checking-only IMAP field when validating SMTP', () => {
    const acc = account({ smtp: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'smtpuser', password: 'smtppass' } } as Partial<ImapAccount>);
    expect(() => assertCredentialsResolved(acc, 'smtp')).not.toThrow();
  });
});

// The wizard is a static asset and cannot import the server module, so the
// normalization is written out twice. Assert the copies agree.
describe('wizard/server env var name parity', () => {
  it('public/js/app.js normalizes account names the same way', () => {
    const appJs = readFileSync(join(process.cwd(), 'public/js/app.js'), 'utf-8');
    const match = appJs.match(/function envVarName\(accountName, suffix\) \{([\s\S]*?)\n\}/);
    expect(match, 'envVarName() not found in public/js/app.js').toBeTruthy();

    // eslint-disable-next-line no-new-func
    const wizardEnvVarName = new Function('accountName', 'suffix', match![1]) as
      (accountName: string, suffix: string) => string;

    for (const name of ['Work Gmail', 'mail.example.com', 'Büro-2', 'a1']) {
      expect(wizardEnvVarName(name, '_IMAP_PASSWORD'))
        .toBe(envVarName(name, '_IMAP_PASSWORD'));
    }
  });
});

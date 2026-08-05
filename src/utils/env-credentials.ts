import type { ImapAccount } from '../types/index.js';

/**
 * Env-variable suffixes for the four credentials an account can source from the
 * environment instead of `accounts.json`.
 */
export const ENV_CREDENTIAL_SUFFIXES = {
  imapUser: '_IMAP_USERNAME',
  imapPassword: '_IMAP_PASSWORD',
  smtpUser: '_SMTP_USERNAME',
  smtpPassword: '_SMTP_PASSWORD',
} as const;

/**
 * Normalize an account name into the key segment of its env variables:
 * uppercase, every non-alphanumeric character replaced by "_". Mirrored in
 * `public/js/app.js` so the setup wizard can display the exact variable name.
 */
export function envAccountKey(accountName: string): string {
  return accountName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function envVarName(accountName: string, suffix: string): string {
  return `IMAP_MCP_ACCOUNT_${envAccountKey(accountName)}${suffix}`;
}

/**
 * An empty credential is the marker the setup wizard writes for "supplied via
 * environment variable". If the variable was not set when the server started,
 * the field is still empty by the time we dial out — and the provider answers
 * with a generic authentication failure that looks exactly like a wrong
 * password. Fail here instead, naming the variable that is missing.
 *
 * Only empty strings trip this: an account whose credentials live in
 * `accounts.json` is unaffected.
 */
export function assertCredentialsResolved(account: ImapAccount, channel: 'imap' | 'smtp'): void {
  const missing: string[] = [];
  const require = (value: string | undefined, suffix: string) => {
    if (value === '') missing.push(envVarName(account.name, suffix));
  };

  if (channel === 'imap') {
    require(account.user, ENV_CREDENTIAL_SUFFIXES.imapUser);
    require(account.password, ENV_CREDENTIAL_SUFFIXES.imapPassword);
  } else {
    // SMTP falls back to the IMAP credentials when it has none of its own, so
    // report whichever field is actually blank.
    if (account.smtp?.user === '') {
      missing.push(envVarName(account.name, ENV_CREDENTIAL_SUFFIXES.smtpUser));
    } else if (!(account.smtp?.user || account.user)) {
      require(account.user, ENV_CREDENTIAL_SUFFIXES.imapUser);
    }

    if (account.smtp?.password === '') {
      missing.push(envVarName(account.name, ENV_CREDENTIAL_SUFFIXES.smtpPassword));
    } else if (!(account.smtp?.password || account.password)) {
      require(account.password, ENV_CREDENTIAL_SUFFIXES.imapPassword);
    }
  }

  if (missing.length === 0) return;

  const label = channel === 'imap' ? 'IMAP' : 'SMTP';
  throw new Error(
    `Account "${account.name}" has ${label} credentials marked as environment-managed, ` +
    `but ${missing.length === 1 ? 'this variable was' : 'these variables were'} not set when ` +
    `the server started: ${missing.join(', ')}. Set ${missing.length === 1 ? 'it' : 'them'} ` +
    `and restart the server, or store the credentials on the account via imap_update_account.`
  );
}

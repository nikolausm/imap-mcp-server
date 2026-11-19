/**
 * Optional OS keyring access via @napi-rs/keyring.
 * Soft-fails when the native binding is missing or the desktop secret service
 * is unavailable — callers must tolerate undefined / false returns.
 *
 * Loaded synchronously via createRequire so AccountManager can stay sync at
 * the getAccount boundary (vault/keyring secrets are hydrated into the
 * encrypted in-memory cache at startup).
 */

import { createRequire } from 'module';

export const KEYRING_SERVICE = 'imap-mcp';
export const STORE_DEK_NAME = 'store-dek';

export type AccountSecretField =
  | 'imap-password'
  | 'smtp-password'
  | 'imap-user'
  | 'smtp-user';

export function accountSecretName(accountId: string, field: AccountSecretField): string {
  return `account:${accountId}:${field}`;
}

type EntryCtor = new (service: string, name: string) => {
  getPassword(): string;
  setPassword(password: string): void;
  deletePassword(): void;
};

let entryCtor: EntryCtor | null | undefined;

function loadEntryCtor(): EntryCtor | null {
  if (entryCtor !== undefined) return entryCtor;
  // Vitest runs without a desktop keyring mock by default; opt in with IMAP_MCP_TEST_KEYRING=1.
  if (process.env.VITEST && process.env.IMAP_MCP_TEST_KEYRING !== '1') {
    entryCtor = null;
    return null;
  }
  try {
    const require = createRequire(import.meta.url);
    const mod = require('@napi-rs/keyring') as { Entry: EntryCtor };
    entryCtor = mod.Entry;
    return entryCtor;
  } catch {
    entryCtor = null;
    return null;
  }
}

/** Test hook: inject or clear the Entry constructor. */
export function __setKeyringEntryCtorForTests(ctor: EntryCtor | null | undefined): void {
  entryCtor = ctor;
}

export function isKeyringAvailable(): boolean {
  return loadEntryCtor() !== null;
}

export function getKeyringSecret(name: string): string | undefined {
  const Entry = loadEntryCtor();
  if (!Entry) return undefined;
  try {
    const entry = new Entry(KEYRING_SERVICE, name);
    const value = entry.getPassword();
    if (value === null || value === undefined || value === '') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function setKeyringSecret(name: string, value: string): boolean {
  const Entry = loadEntryCtor();
  if (!Entry) return false;
  try {
    const entry = new Entry(KEYRING_SERVICE, name);
    entry.setPassword(value);
    return true;
  } catch {
    return false;
  }
}

export function deleteKeyringSecret(name: string): boolean {
  const Entry = loadEntryCtor();
  if (!Entry) return false;
  try {
    const entry = new Entry(KEYRING_SERVICE, name);
    entry.deletePassword();
    return true;
  } catch {
    return false;
  }
}

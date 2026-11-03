import { describe, it, expect, afterEach } from 'vitest';
import {
  __setKeyringEntryCtorForTests,
  accountSecretName,
  getKeyringSecret,
  isKeyringAvailable,
  setKeyringSecret,
  STORE_DEK_NAME,
} from '../src/credentials/keyring.js';

describe('credentials/keyring', () => {
  afterEach(() => {
    __setKeyringEntryCtorForTests(undefined);
  });

  it('builds stable account secret names', () => {
    expect(accountSecretName('abc', 'imap-password')).toBe('account:abc:imap-password');
  });

  it('soft-fails when Entry is unavailable', () => {
    __setKeyringEntryCtorForTests(null);
    expect(isKeyringAvailable()).toBe(false);
    expect(getKeyringSecret(STORE_DEK_NAME)).toBeUndefined();
    expect(setKeyringSecret(STORE_DEK_NAME, 'x')).toBe(false);
  });

  it('reads and writes via injected Entry', () => {
    const mem = new Map<string, string>();
    class FakeEntry {
      constructor(private service: string, private name: string) {}
      getPassword() {
        const v = mem.get(`${this.service}|${this.name}`);
        if (v === undefined) throw new Error('not found');
        return v;
      }
      setPassword(v: string) {
        mem.set(`${this.service}|${this.name}`, v);
      }
      deletePassword() {
        mem.delete(`${this.service}|${this.name}`);
      }
    }
    __setKeyringEntryCtorForTests(FakeEntry as any);
    expect(isKeyringAvailable()).toBe(true);
    expect(setKeyringSecret('store-dek', 'abc')).toBe(true);
    expect(getKeyringSecret('store-dek')).toBe('abc');
  });
});

import { describe, it, expect } from 'vitest';
import { classifyCopyDestination } from '../src/utils/copy-policy.js';
import { getProviderById, resolveAccountProvider, accountProviderIds } from '../src/providers/email-providers.js';

const behaviorOf = (id: string) => getProviderById(id)?.copyBehavior;

describe('classifyCopyDestination with the registry copyBehavior', () => {
  it.each([
    // [provider id, destination, specialUse, expected kind, expected reason]
    ['protonmail', 'Labels/Trip', undefined, 'preserving', undefined],
    ['protonmail', 'Labels/2024 KEF-AMS', undefined, 'preserving', undefined],
    ['protonmail', 'Folders/Receipts', undefined, 'refused', 'destination_may_move_source'],
    ['protonmail', 'Folders/Seattle/Housing', undefined, 'refused', 'destination_may_move_source'],
    ['protonmail', 'INBOX', '\\Inbox', 'refused', 'destination_may_move_source'],
    ['protonmail', 'Archive', '\\Archive', 'refused', 'destination_may_move_source'],
    ['protonmail', 'Sent', '\\Sent', 'refused', 'destination_may_move_source'],
    ['protonmail', 'All Mail', '\\All', 'refused', 'destination_may_move_source'],
    ['protonmail', 'Starred', '\\Flagged', 'refused', 'destination_may_move_source'],
    ['protonmail', 'Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
    ['protonmail', 'Spam', '\\Junk', 'refused', 'destination_is_trash_or_junk'],
    ['gmail', 'Trip', undefined, 'preserving', undefined],
    ['gmail', 'Work/Clients', undefined, 'preserving', undefined],
    ['gmail', 'INBOX', '\\Inbox', 'refused', 'destination_not_verified'],
    ['gmail', '[Gmail]/Starred', '\\Flagged', 'refused', 'destination_not_verified'],
    ['gmail', '[Gmail]/All Mail', '\\All', 'refused', 'destination_not_verified'],
    ['gmail', '[Google Mail]/Sent Mail', '\\Sent', 'refused', 'destination_not_verified'],
    ['gmail', '[Gmail]/Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
    ['gmail', '[Gmail]/Spam', '\\Junk', 'refused', 'destination_is_trash_or_junk'],
    // Providers without a copyBehavior.
    ['fastmail', 'Projects', undefined, 'unverified', undefined],
    ['fastmail', 'Archive', '\\Archive', 'unverified', undefined],
    ['fastmail', 'Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
  ] as const)('%s → %s (%s) is %s %s', (id, destination, specialUse, kind, reason) => {
    const verdict = classifyCopyDestination({ behavior: behaviorOf(id), destination, specialUse });
    expect(verdict.kind).toBe(kind);
    if (reason) {
      expect(verdict).toMatchObject({ reason, message: expect.stringContaining(destination) });
    }
  });

  it('refuses Junk without any provider behaviour', () => {
    expect(classifyCopyDestination({ destination: 'INBOX.Junk', specialUse: '\\Junk' }))
      .toMatchObject({ kind: 'refused', reason: 'destination_is_trash_or_junk' });
    expect(classifyCopyDestination({ destination: 'INBOX.Projects' }).kind).toBe('unverified');
  });

  it('names the provider and the allowed prefix in a refusal', () => {
    const verdict = classifyCopyDestination({
      providerName: 'Proton Mail', behavior: behaviorOf('protonmail'), destination: 'Folders/Receipts',
    });
    expect(verdict).toMatchObject({ message: expect.stringMatching(/^On Proton Mail, .*"Labels\/<name>"/) });
  });

  it('only gmail and protonmail carry a copyBehavior today', () => {
    expect(accountProviderIds.filter(id => behaviorOf(id))).toEqual(['gmail', 'protonmail']);
  });
});

describe('resolveAccountProvider', () => {
  it('uses the explicit provider field over the host', () => {
    expect(resolveAccountProvider({ provider: 'protonmail', host: 'protonmail-bridge' })?.id).toBe('protonmail');
    expect(resolveAccountProvider({ provider: 'protonmail', host: 'imap.gmail.com' })?.id).toBe('protonmail');
  });

  it('falls back to the registry IMAP host, case-insensitively', () => {
    expect(resolveAccountProvider({ host: 'imap.gmail.com' })?.id).toBe('gmail');
    expect(resolveAccountProvider({ host: 'IMAP.GMAIL.COM' })?.id).toBe('gmail');
    expect(resolveAccountProvider({ host: '127.0.0.1' })?.id).toBe('protonmail');
  });

  it('returns undefined when neither identifies a provider', () => {
    expect(resolveAccountProvider({ host: 'protonmail-bridge' })).toBeUndefined();
    expect(resolveAccountProvider({ host: 'mail.example.com' })).toBeUndefined();
    expect(resolveAccountProvider({ provider: 'nope', host: 'imap.gmail.com' })).toBeUndefined();
  });

  it('never resolves to the "custom" placeholder entry', () => {
    expect(accountProviderIds).not.toContain('custom');
    expect(resolveAccountProvider({ host: '' })).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { classifyCopyDestination, isTrashOrJunk } from '../src/utils/copy-policy.js';
import { getProviderById, resolveAccountProvider, accountProviderIds } from '../src/providers/email-providers.js';

const behaviorOf = (id: string) => getProviderById(id)?.copyBehavior;

describe('classifyCopyDestination with the registry copyBehavior', () => {
  it.each([
    // [provider id, destination, specialUse, expected kind, expected reason]
    ['protonmail', 'Labels/Trip', undefined, 'label_destination', undefined],
    ['protonmail', 'Labels/2024 KEF-AMS', undefined, 'label_destination', undefined],
    ['protonmail', 'Folders/Receipts', undefined, 'refused', 'destination_may_move_source'],
    ['protonmail', 'Folders/Seattle/Housing', undefined, 'refused', 'destination_may_move_source'],
    ['protonmail', 'INBOX', '\\Inbox', 'refused', 'destination_may_move_source'],
    ['protonmail', 'Archive', '\\Archive', 'refused', 'destination_is_system_folder'],
    ['protonmail', 'Sent', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['protonmail', 'All Mail', '\\All', 'refused', 'destination_is_system_folder'],
    ['protonmail', 'Starred', '\\Flagged', 'refused', 'destination_is_system_folder'],
    ['protonmail', 'Drafts', '\\Drafts', 'refused', 'destination_is_system_folder'],
    // A label path carrying a system role is still a system folder.
    ['protonmail', 'Labels/Sent', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['protonmail', 'Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
    ['protonmail', 'Spam', '\\Junk', 'refused', 'destination_is_trash_or_junk'],
    ['gmail', 'Trip', undefined, 'label_destination', undefined],
    ['gmail', 'Work/Clients', undefined, 'label_destination', undefined],
    ['gmail', 'INBOX', '\\Inbox', 'refused', 'destination_not_verified'],
    ['gmail', '[Gmail]/Starred', '\\Flagged', 'refused', 'destination_is_system_folder'],
    ['gmail', '[Gmail]/All Mail', '\\All', 'refused', 'destination_is_system_folder'],
    ['gmail', '[Google Mail]/Sent Mail', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['gmail', '[Gmail]/Important', '\\Important', 'refused', 'destination_is_system_folder'],
    // System roles on paths outside [Gmail]/, including localized names.
    ['gmail', 'Sent', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Archive', '\\All', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Drafts', '\\Drafts', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Gesendet', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Entwürfe', '\\Drafts', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Alle Nachrichten', '\\All', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Markiert', '\\Flagged', 'refused', 'destination_is_system_folder'],
    ['gmail', 'Papierkorb', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
    // No role reported: the path rules still refuse.
    ['gmail', '[Gmail]/Starred', undefined, 'refused', 'destination_not_verified'],
    ['gmail', '[Google Mail]/Gesendet', undefined, 'refused', 'destination_not_verified'],
    ['gmail', 'INBOX', undefined, 'refused', 'destination_not_verified'],
    ['gmail', '[Gmail]/Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
    ['gmail', '[Gmail]/Spam', '\\Junk', 'refused', 'destination_is_trash_or_junk'],
    // Providers without a copyBehavior.
    ['fastmail', 'Projects', undefined, 'unverified', undefined],
    ['fastmail', 'Archive', '\\Archive', 'refused', 'destination_is_system_folder'],
    ['fastmail', 'Sent Items', '\\Sent', 'refused', 'destination_is_system_folder'],
    ['fastmail', 'INBOX', '\\Inbox', 'unverified', undefined],
    ['fastmail', 'Trash', '\\Trash', 'refused', 'destination_is_trash_or_junk'],
  ] as const)('%s → %s (%s) is %s %s', (id, destination, specialUse, kind, reason) => {
    const verdict = classifyCopyDestination({ behavior: behaviorOf(id), destination, specialUse });
    expect(verdict.kind).toBe(kind);
    if (reason) {
      expect(verdict).toMatchObject({ reason, message: expect.stringContaining(destination) });
    }
  });

  it.each([
    ['gmail', '[Gmail]', ['\\HasChildren', '\\NonExistent', '\\Noselect']],
    ['gmail', 'Projects', ['\\NoSelect']],
    ['protonmail', 'Labels', ['\\Noselect', '\\Unmarked']],
    ['protonmail', 'Folders', ['\\Noselect']],
    [undefined, 'INBOX.Archive', ['\\NonExistent']],
  ] as const)('%s: refuses unselectable "%s" before any other rule', (id, destination, attributes) => {
    expect(classifyCopyDestination({ behavior: id ? behaviorOf(id) : undefined, destination, attributes: [...attributes] }))
      .toMatchObject({ kind: 'refused', reason: 'destination_not_selectable' });
  });

  it('isTrashOrJunk reads specialUse or the LIST flags', () => {
    expect(isTrashOrJunk('\\Trash', undefined)).toBe(true);
    expect(isTrashOrJunk(undefined, ['\\HasNoChildren', '\\JUNK'])).toBe(true);
    expect(isTrashOrJunk('\\Sent', ['\\Sent'])).toBe(false);
    expect(isTrashOrJunk(undefined, undefined)).toBe(false);
  });

  it('refuses the owner\'s Gmail examples as system folders', () => {
    for (const [destination, specialUse] of [['Sent', '\\Sent'], ['Archive', '\\All'], ['Drafts', '\\Drafts']]) {
      expect(classifyCopyDestination({ behavior: behaviorOf('gmail'), destination, specialUse }))
        .toMatchObject({ kind: 'refused', reason: 'destination_is_system_folder' });
    }
  });

  it('reads the role from the LIST flags when specialUse is unset, case-insensitively', () => {
    expect(classifyCopyDestination({
      behavior: behaviorOf('protonmail'), destination: 'All Mail', attributes: ['\\HasNoChildren', '\\All'],
    })).toMatchObject({ kind: 'refused', reason: 'destination_is_system_folder', message: expect.stringContaining('\\All') });
    expect(classifyCopyDestination({
      behavior: behaviorOf('gmail'), destination: 'Archiv', attributes: ['\\ARCHIVE'],
    })).toMatchObject({ kind: 'refused', reason: 'destination_is_system_folder' });
    expect(classifyCopyDestination({
      destination: 'INBOX.Spam', attributes: ['\\Junk'],
    })).toMatchObject({ kind: 'refused', reason: 'destination_is_trash_or_junk' });
    expect(classifyCopyDestination({
      behavior: behaviorOf('gmail'), destination: 'Trip', attributes: ['\\HasNoChildren'],
    })).toEqual({ kind: 'label_destination' });
  });

  it('refuses system roles on a server with no identified provider', () => {
    for (const specialUse of ['\\All', '\\Archive', '\\Drafts', '\\Flagged', '\\Sent', '\\Important']) {
      expect(classifyCopyDestination({ destination: 'X', specialUse }))
        .toMatchObject({ kind: 'refused', reason: 'destination_is_system_folder' });
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

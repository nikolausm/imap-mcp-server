import { describe, it, expect } from 'vitest';
import { selectSearchFolders, isNonSelectable } from '../src/utils/search-folders.js';
import type { Folder } from '../src/types/index.js';

// Compact folder factory for tests.
const f = (
  name: string,
  opts: { delimiter?: string; attributes?: string[]; specialUse?: string } = {}
): Folder => ({
  name,
  delimiter: opts.delimiter ?? '/',
  attributes: opts.attributes ?? [],
  specialUse: opts.specialUse,
});

describe('selectSearchFolders', () => {
  it('keeps normal folders and skips Trash/Spam/Drafts by default (name-based)', () => {
    const folders = [
      f('INBOX'),
      f('Archive'),
      f('Invoices'),
      f('Sent'),
      f('Trash'),
      f('Spam'),
      f('Junk'),
      f('Drafts'),
    ];
    expect(selectSearchFolders(folders)).toEqual(['INBOX', 'Archive', 'Invoices', 'Sent']);
  });

  it('detects noisy folders via RFC 6154 SPECIAL-USE flags regardless of name', () => {
    const folders = [
      f('INBOX'),
      f('Papierkorb', { specialUse: '\\Trash' }),
      f('Werbung', { specialUse: '\\Junk' }),
      f('Entwürfe', { specialUse: '\\Drafts' }),
    ];
    expect(selectSearchFolders(folders)).toEqual(['INBOX']);
  });

  it('opts noisy categories back in individually', () => {
    const folders = [f('INBOX'), f('Trash'), f('Spam'), f('Drafts')];
    expect(selectSearchFolders(folders, { includeTrash: true })).toContain('Trash');
    expect(selectSearchFolders(folders, { includeTrash: true })).not.toContain('Spam');
    expect(selectSearchFolders(folders, { includeSpam: true })).toContain('Spam');
    expect(selectSearchFolders(folders, { includeDrafts: true })).toContain('Drafts');
    expect(selectSearchFolders(folders, { includeTrash: true, includeSpam: true, includeDrafts: true }))
      .toEqual(['INBOX', 'Trash', 'Spam', 'Drafts']);
  });

  it('is leaf-aware for hierarchical names ([Gmail]/Trash, INBOX.Drafts)', () => {
    const folders = [
      f('INBOX'),
      f('[Gmail]/All Mail', { delimiter: '/' }),
      f('[Gmail]/Trash', { delimiter: '/' }),
      f('INBOX.Archive', { delimiter: '.' }),
      f('INBOX.Drafts', { delimiter: '.' }),
    ];
    expect(selectSearchFolders(folders)).toEqual(['INBOX', '[Gmail]/All Mail', 'INBOX.Archive']);
  });

  it('skips non-selectable container folders', () => {
    const folders = [f('INBOX'), f('[Gmail]', { attributes: ['\\Noselect'] }), f('Work')];
    expect(selectSearchFolders(folders)).toEqual(['INBOX', 'Work']);
  });

  it('always skips Blocked folders even with all include-flags', () => {
    const folders = [f('INBOX'), f('Blocked')];
    expect(selectSearchFolders(folders, { includeTrash: true, includeSpam: true, includeDrafts: true }))
      .toEqual(['INBOX']);
  });

  it('matches folder names case-insensitively', () => {
    const folders = [f('INBOX'), f('TRASH'), f('junk'), f('DrAfTs')];
    expect(selectSearchFolders(folders)).toEqual(['INBOX']);
  });
});

describe('isNonSelectable', () => {
  it('is true for \\Noselect folders (case-insensitive)', () => {
    expect(isNonSelectable(f('x', { attributes: ['\\Noselect'] }))).toBe(true);
    expect(isNonSelectable(f('x', { attributes: ['\\noselect'] }))).toBe(true);
  });
  it('is false for ordinary folders', () => {
    expect(isNonSelectable(f('INBOX'))).toBe(false);
  });
});

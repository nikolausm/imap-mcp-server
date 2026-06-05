import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';
import type { Folder } from '../src/types/index.js';

/**
 * Covers findSpecialUseFolder() — the RFC 6154 resolution introduced in #83
 * and hardened afterwards to actually read imapflow's parsed `specialUse`
 * field (the original PR only checked `attributes`, which is a Set and never
 * matched, so Priority 1 was dead code).
 */
describe('ImapService.findSpecialUseFolder', () => {
  let service: ImapService;

  const folder = (name: string, opts: Partial<Folder> = {}): Folder => ({
    name,
    delimiter: '/',
    attributes: opts.attributes ?? [],
    specialUse: opts.specialUse,
  });

  beforeEach(() => {
    service = new ImapService();
    vi.restoreAllMocks();
  });

  it('resolves a localized folder via imapflow specialUse (Priority 1)', async () => {
    // Sherweb / Outlook FR: localized name, but server advertises \Sent.
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('INBOX'),
      folder('Éléments envoyés', { specialUse: '\\Sent' }),
      folder('Brouillons', { specialUse: '\\Drafts' }),
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', ['Sent', 'Sent Items']);
    expect(sent).toBe('Éléments envoyés');
  });

  it('matches the special-use flag case-insensitively', async () => {
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('Gesendete Elemente', { specialUse: '\\sent' }),
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', []);
    expect(sent).toBe('Gesendete Elemente');
  });

  it('falls back to a raw SPECIAL-USE flag in attributes (Priority 2)', async () => {
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('INBOX'),
      folder('Posta inviata', { attributes: ['\\HasNoChildren', '\\Sent'] }),
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', ['Sent']);
    expect(sent).toBe('Posta inviata');
  });

  it('falls back to the localized name list when nothing is advertised (Priority 3)', async () => {
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('INBOX'),
      folder('Enviados'),
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', ['Enviados', 'Sent']);
    expect(sent).toBe('Enviados');
  });

  it('prefers the special-use flag over a coincidental name match', async () => {
    // A misnamed "Sent" folder exists, but the real one is flagged.
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('Sent', { attributes: ['\\HasNoChildren'] }),       // name match only
      folder('Éléments envoyés', { specialUse: '\\Sent' }),       // real sent folder
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', ['Sent']);
    expect(sent).toBe('Éléments envoyés');
  });

  it('returns undefined when neither flag nor name matches', async () => {
    vi.spyOn(service, 'listFolders').mockResolvedValue([
      folder('INBOX'),
      folder('Archive', { specialUse: '\\Archive' }),
    ]);

    const sent = await service.findSpecialUseFolder('acc1', '\\Sent', ['Sent', 'Sent Items']);
    expect(sent).toBeUndefined();
  });
});

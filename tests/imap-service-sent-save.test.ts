import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';

/**
 * Covers appendToSentFolder() — issue #125: sent-folder auto-save must not
 * fail silently. The method now returns a structured { saved, folder, error }
 * result and honors a per-account sentFolder override.
 */
describe('ImapService.appendToSentFolder', () => {
  let service: ImapService;
  let append: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ImapService();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    append = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(service as any, 'ensureConnected').mockResolvedValue({ append });
  });

  it('saves to the auto-detected Sent folder and reports which one', async () => {
    vi.spyOn(service, 'findSpecialUseFolder').mockResolvedValue('Gesendet');

    const result = await service.appendToSentFolder('acc1', 'raw message');

    expect(result).toEqual({ saved: true, folder: 'Gesendet' });
    expect(append).toHaveBeenCalledWith('Gesendet', 'raw message', ['\\Seen']);
  });

  it('uses the sentFolder override and skips auto-detection', async () => {
    const detect = vi.spyOn(service, 'findSpecialUseFolder');

    const result = await service.appendToSentFolder('acc1', 'raw message', '[Gmail]/Gesendet');

    expect(result).toEqual({ saved: true, folder: '[Gmail]/Gesendet' });
    expect(detect).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith('[Gmail]/Gesendet', 'raw message', ['\\Seen']);
  });

  it('returns an actionable error when no Sent folder can be found', async () => {
    vi.spyOn(service, 'findSpecialUseFolder').mockResolvedValue(undefined);

    const result = await service.appendToSentFolder('acc1', 'raw message');

    expect(result.saved).toBe(false);
    expect(result.folder).toBeUndefined();
    expect(result.error).toContain('No Sent folder found');
    expect(result.error).toContain('sentFolder');
    expect(append).not.toHaveBeenCalled();
  });

  it('returns the append failure reason instead of a silent false', async () => {
    vi.spyOn(service, 'findSpecialUseFolder').mockResolvedValue('Sent');
    append.mockRejectedValueOnce(new Error('Mailbox does not exist'));

    const result = await service.appendToSentFolder('acc1', 'raw message');

    expect(result.saved).toBe(false);
    expect(result.folder).toBe('Sent');
    expect(result.error).toContain('Failed to append to "Sent"');
    expect(result.error).toContain('Mailbox does not exist');
  });

  it('hints at a bad override when appending to the configured sentFolder fails', async () => {
    append.mockRejectedValueOnce(new Error('NO [NONEXISTENT] Unknown Mailbox'));

    const result = await service.appendToSentFolder('acc1', 'raw message', 'Typo/Sent');

    expect(result.saved).toBe(false);
    expect(result.folder).toBe('Typo/Sent');
    expect(result.error).toContain('configured sentFolder');
  });
});

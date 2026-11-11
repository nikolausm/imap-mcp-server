import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';
import { ImapOperationError } from '../src/utils/operation-error.js';

let copyEmailHandler: Function;
let copyEmailDescription: string;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_copy_email') {
      copyEmailHandler = handler;
      copyEmailDescription = _schema.description;
    }
  }),
};

const mockImapService = {
  copyEmail: vi.fn(),
};

async function call(args: Record<string, unknown>) {
  const result = await copyEmailHandler({ accountId: 'acc1', folder: 'INBOX', targetFolder: 'Labels/Trip', ...args });
  return JSON.parse(result.content[0].text);
}

describe('imap_copy_email Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any, {} as any);
  });

  it('should be registered', () => {
    expect(copyEmailHandler).toBeDefined();
  });

  it('reports a single copied UID with its uidMap', async () => {
    mockImapService.copyEmail.mockResolvedValueOnce({
      source: 'INBOX',
      destination: 'Labels/Trip',
      provider: 'protonmail',
      preservation: 'verified',
      results: [{ uid: 100, status: 'copied', uidMap: { 100: 7 } }],
    });

    const parsed = await call({ uid: 100 });

    expect(mockImapService.copyEmail).toHaveBeenCalledWith('acc1', 'INBOX', 100, 'Labels/Trip', { acknowledgeSourceMayChange: undefined });
    expect(parsed).toMatchObject({
      success: true,
      partial: false,
      uncertain: false,
      copiedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
      notAttemptedCount: 0,
      provider: 'protonmail',
      preservation: 'verified',
    });
    expect(parsed.results[0].uidMap).toEqual({ '100': 7 });
  });

  it('omits uidMap when the server gave none', async () => {
    mockImapService.copyEmail.mockResolvedValueOnce({
      source: 'INBOX',
      destination: 'Labels/Trip',
      provider: 'protonmail',
      preservation: 'verified',
      results: [{ uid: 100, status: 'copied' }],
    });

    const parsed = await call({ uid: 100 });

    expect(parsed.success).toBe(true);
    expect(parsed.results[0]).not.toHaveProperty('uidMap');
  });

  it('distinguishes partial from uncertain outcomes in a batch', async () => {
    mockImapService.copyEmail.mockResolvedValueOnce({
      source: 'INBOX',
      destination: 'Labels/Trip',
      provider: 'protonmail',
      preservation: 'verified',
      results: [
        { uid: 1, status: 'copied' },
        { uid: 2, status: 'failed', error: 'UID 2 not found in "INBOX"' },
        { uid: 3, status: 'uncertain', error: 'The connection dropped' },
        { uid: 4, status: 'not_attempted', error: 'Skipped' },
      ],
    });

    const parsed = await call({ uid: [1, 2, 3, 4] });

    expect(parsed).toMatchObject({
      success: false,
      partial: true,
      uncertain: true,
      copiedCount: 1,
      failedCount: 1,
      uncertainCount: 1,
      notAttemptedCount: 1,
    });
    expect(parsed.message).toContain('check the destination');
  });

  it('reports a batch where nothing was copied as neither success nor partial', async () => {
    mockImapService.copyEmail.mockResolvedValueOnce({
      source: 'INBOX',
      destination: 'Labels/Trip',
      provider: 'protonmail',
      preservation: 'verified',
      results: [{ uid: 1, status: 'failed', error: 'The server refused the copy' }],
    });

    const parsed = await call({ uid: [1] });

    expect(parsed).toMatchObject({ success: false, partial: false, uncertain: false, failedCount: 1 });
  });

  it('passes acknowledgeSourceMayChange through and reports preservation "acknowledged"', async () => {
    mockImapService.copyEmail.mockResolvedValueOnce({
      source: 'INBOX',
      destination: 'INBOX.Projects',
      provider: null,
      preservation: 'acknowledged',
      results: [{ uid: 100, status: 'copied' }],
    });

    const parsed = await call({ uid: 100, targetFolder: 'INBOX.Projects', acknowledgeSourceMayChange: true });

    expect(mockImapService.copyEmail).toHaveBeenCalledWith(
      'acc1', 'INBOX', 100, 'INBOX.Projects', { acknowledgeSourceMayChange: true },
    );
    expect(parsed).toMatchObject({ success: true, provider: null, preservation: 'acknowledged' });
  });

  it('does not promise that the original always stays in place', () => {
    // Preservation depends on the provider, so the description must not promise it.
    expect(copyEmailDescription).not.toMatch(/stays where it is|untouched|must stay in its current folder/i);
    expect(copyEmailDescription).toContain('preservation_unverified');
    expect(copyEmailDescription).toContain('acknowledgeSourceMayChange');
    expect(copyEmailDescription).toMatch(/Folders\/<name>.*refused/s);
  });

  it.each([
    'destination_not_found', 'source_not_found', 'same_folder', 'no_uids',
    'destination_may_move_source', 'destination_is_trash_or_junk', 'destination_not_verified', 'preservation_unverified',
  ])(
    'returns success:false with reason %s',
    async (reason) => {
      mockImapService.copyEmail.mockRejectedValueOnce(new ImapOperationError(reason, `refused: ${reason}`));

      const parsed = await call({ uid: 100 });

      expect(parsed).toMatchObject({ success: false, partial: false, uncertain: false, reason, error: `refused: ${reason}` });
    },
  );

  it('uses reason server_error for unexpected errors', async () => {
    mockImapService.copyEmail.mockRejectedValueOnce(new Error('Failed to reconnect'));

    const parsed = await call({ uid: 100 });

    expect(parsed).toMatchObject({ success: false, reason: 'server_error' });
  });
});

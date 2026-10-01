import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'fs';
import { writeFileSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';

const TMP_DOWNLOAD_DIR = path.join(os.tmpdir(), `imap-attach-jail-${process.pid}`);
process.env.IMAP_DOWNLOAD_DIR = TMP_DOWNLOAD_DIR;

const { normalizeAttachments } = await import('../src/tools/email-tools.js');

describe('normalizeAttachments — path jail', () => {
  const uploads = path.join(TMP_DOWNLOAD_DIR, 'uploads');
  const outside = path.join(os.tmpdir(), `imap-attach-outside-${process.pid}`);

  beforeAll(async () => {
    await fsp.rm(TMP_DOWNLOAD_DIR, { recursive: true, force: true });
    mkdirSync(uploads, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(uploads, 'ok.pdf'), 'PDF');
    writeFileSync(path.join(outside, 'steal.txt'), 'SECRET');
  });

  afterAll(async () => {
    await fsp.rm(TMP_DOWNLOAD_DIR, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it('accepts a path under the upload jail', async () => {
    const result = await normalizeAttachments([
      { filename: 'ok.pdf', path: path.join(uploads, 'ok.pdf') },
    ]);
    expect(result.attachments).toHaveLength(1);
    expect(result.diagnostics[0].source).toBe('path');
  });

  it('rejects a path outside the jail', async () => {
    await expect(
      normalizeAttachments([{ filename: 'steal.txt', path: path.join(outside, 'steal.txt') }]),
    ).rejects.toThrow(/allowlisted|jail|attachment/i);
  });

  it('rejects credential-store paths', async () => {
    const keyPath = path.join(os.homedir(), '.imap-mcp', '.key');
    await expect(
      normalizeAttachments([{ filename: 'key', path: keyPath }]),
    ).rejects.toThrow(/credential store/);
  });
});

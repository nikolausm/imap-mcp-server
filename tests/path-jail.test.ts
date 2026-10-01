import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'fs';
import { writeFileSync, mkdirSync, symlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  assertPathInsideJail,
  isPathInside,
  resolveAttachmentAllowRoots,
  resolveDownloadRoot,
  resolveJailedSavePath,
} from '../src/utils/path-jail.js';

const TMP = path.join(os.tmpdir(), `imap-path-jail-${process.pid}`);
const DOWNLOAD = path.join(TMP, 'downloads');
const UPLOADS = path.join(DOWNLOAD, 'uploads');
const OUTSIDE = path.join(TMP, 'outside');
const FAKE_HOME = path.join(TMP, 'fake-home');
const CRED_STORE = path.join(FAKE_HOME, '.imap-mcp');

describe('path-jail', () => {
  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    mkdirSync(UPLOADS, { recursive: true });
    mkdirSync(OUTSIDE, { recursive: true });
    mkdirSync(CRED_STORE, { recursive: true });
    writeFileSync(path.join(UPLOADS, 'ok.txt'), 'hello');
    writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'nope');
    writeFileSync(path.join(CRED_STORE, '.key'), 'fake-key-material');
    writeFileSync(path.join(CRED_STORE, 'accounts.json'), '[]');
  });

  afterAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
  });

  it('resolveDownloadRoot honors IMAP_DOWNLOAD_DIR', () => {
    expect(resolveDownloadRoot({ IMAP_DOWNLOAD_DIR: DOWNLOAD })).toBe(path.resolve(DOWNLOAD));
  });

  it('resolveAttachmentAllowRoots includes download root and uploads', () => {
    const roots = resolveAttachmentAllowRoots({ IMAP_DOWNLOAD_DIR: DOWNLOAD });
    expect(roots.map((r) => path.resolve(r))).toEqual(
      expect.arrayContaining([path.resolve(DOWNLOAD), path.resolve(UPLOADS)]),
    );
  });

  it('isPathInside detects containment and rejects escapes', () => {
    expect(isPathInside(path.join(DOWNLOAD, 'a.txt'), DOWNLOAD)).toBe(true);
    expect(isPathInside(path.join(OUTSIDE, 'secret.txt'), DOWNLOAD)).toBe(false);
    expect(isPathInside(path.join(DOWNLOAD, '..', 'outside', 'secret.txt'), DOWNLOAD)).toBe(false);
  });

  it('allows a file inside the upload jail', () => {
    const p = assertPathInsideJail(
      path.join(UPLOADS, 'ok.txt'),
      resolveAttachmentAllowRoots({ IMAP_DOWNLOAD_DIR: DOWNLOAD }),
      { label: 'attachment' },
    );
    expect(p).toBe(path.resolve(UPLOADS, 'ok.txt'));
  });

  it('rejects an absolute path outside the jail', () => {
    expect(() =>
      assertPathInsideJail(
        path.join(OUTSIDE, 'secret.txt'),
        resolveAttachmentAllowRoots({ IMAP_DOWNLOAD_DIR: DOWNLOAD }),
        { label: 'attachment' },
      ),
    ).toThrow(/allowlisted directory/);
  });

  it('rejects credential-store paths', () => {
    // Simulate ~/.imap-mcp by pointing HOMEDIR via the absolute path check —
    // assertPathInsideJail uses os.homedir(); we still reject any path under
    // a directory literally named .imap-mcp when it matches the resolved store
    // OR when the candidate path string resolves under the real homedir store.
    // Here we pass the real credential store root if present-shaped.
    const storeKey = path.join(os.homedir(), '.imap-mcp', '.key');
    expect(() =>
      assertPathInsideJail(
        storeKey,
        resolveAttachmentAllowRoots({ IMAP_DOWNLOAD_DIR: DOWNLOAD }),
        { label: 'attachment', rejectCredentialStore: true },
      ),
    ).toThrow(/credential store/);
  });

  it('resolveJailedSavePath confines absolute escapes', () => {
    expect(() =>
      resolveJailedSavePath(path.join(OUTSIDE, 'planted.bin'), DOWNLOAD, 'fallback.bin'),
    ).toThrow(/savePath/);
  });

  it('resolveJailedSavePath resolves relative paths under the download root', () => {
    const target = resolveJailedSavePath('subdir/file.bin', DOWNLOAD, 'fallback.bin');
    expect(target).toBe(path.resolve(DOWNLOAD, 'subdir', 'file.bin'));
  });

  it('resolveJailedSavePath uses basename fallback when savePath omitted', () => {
    expect(resolveJailedSavePath(undefined, DOWNLOAD, 'mail.pdf')).toBe(
      path.join(DOWNLOAD, 'mail.pdf'),
    );
  });

  it('rejects symlink leaves when rejectSymlinkLeaf is set', () => {
    const link = path.join(UPLOADS, 'escape-link');
    try {
      symlinkSync(path.join(OUTSIDE, 'secret.txt'), link);
    } catch {
      // Windows without symlink privilege — skip
      return;
    }
    expect(() =>
      assertPathInsideJail(
        link,
        resolveAttachmentAllowRoots({ IMAP_DOWNLOAD_DIR: DOWNLOAD }),
        { label: 'attachment', rejectSymlinkLeaf: true },
      ),
    ).toThrow(/symlink/);
  });
});

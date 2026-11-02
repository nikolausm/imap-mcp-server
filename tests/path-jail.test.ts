import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { assertPathInsideJail, readJailedAttachment, resolveJailedSavePath, writeJailedFile } from '../src/utils/path-jail.js';
import { emailTools, normalizeAttachments } from '../src/tools/email-tools.js';

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => process.env.JAIL_TEST_HOME || actual.homedir() };
});

let temp: string;
let root: string;
let outside: string;
beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'imap-jail-')));
  root = join(temp, 'downloads');
  outside = join(temp, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  vi.stubEnv('IMAP_DOWNLOAD_DIR', root);
  vi.stubEnv('IMAP_ATTACHMENT_DIRS', '');
  vi.stubEnv('JAIL_TEST_HOME', join(temp, 'home'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temp, { recursive: true, force: true });
});

describe('canonical attachment boundaries', () => {
  it('protects the credential store even with broad roots and symlink aliases', () => {
    const store = join(temp, 'home', '.imap-mcp');
    mkdirSync(store, { recursive: true });
    const synthetic = join(store, 'synthetic.txt');
    writeFileSync(synthetic, 'synthetic non-secret fixture');
    symlinkSync(store, join(root, 'store-alias'), 'junction');
    vi.stubEnv('IMAP_ATTACHMENT_DIRS', temp);
    expect(() => readJailedAttachment(synthetic)).toThrow();
    expect(() => readJailedAttachment(join(root, 'store-alias', 'synthetic.txt'))).toThrow();
    expect(() => resolveJailedSavePath(synthetic, temp, 'fallback.txt')).toThrow();
    vi.stubEnv('IMAP_DOWNLOAD_DIR', store);
    expect(() => writeJailedFile(undefined, 'new.txt', Buffer.from('safe'))).toThrow();
  });
  it('allows staged files, buffers bytes immediately, and supports explicit additional roots', async () => {
    const filename = join(root, 'attachment.txt');
    writeFileSync(filename, 'before');
    const normalized = await normalizeAttachments([{ filename: 'attachment.txt', path: filename }]);
    writeFileSync(filename, 'after');
    expect(normalized.attachments![0].content).toEqual(Buffer.from('before'));
    expect(normalized.attachments![0].path).toBeUndefined();
    const extra = join(outside, 'extra.txt');
    writeFileSync(extra, 'extra');
    expect(() => readJailedAttachment(extra)).toThrow();
    vi.stubEnv('IMAP_ATTACHMENT_DIRS', outside + delimiter + root);
    expect(readJailedAttachment(extra).toString()).toBe('extra');
  });

  it('rejects directory symlink escapes for reads and existing/missing writes', async () => {
    writeFileSync(join(outside, 'existing.txt'), 'unchanged');
    symlinkSync(outside, join(root, 'link'), 'junction');
    await expect(normalizeAttachments([{ filename: 'existing.txt', path: join(root, 'link', 'existing.txt') }])).rejects.toThrow();
    expect(() => writeJailedFile('link/existing.txt', 'fallback.txt', Buffer.from('changed'))).toThrow();
    expect(() => writeJailedFile('link/nested/new.txt', 'fallback.txt', Buffer.from('changed'))).toThrow();
    expect(readFileSync(join(outside, 'existing.txt'), 'utf8')).toBe('unchanged');
  });

  it('rejects traversal, sibling-prefix paths, dangling links and leaf symlinks', () => {
    writeFileSync(join(root, 'source.txt'), 'safe');
    symlinkSync(join(root, 'source.txt'), join(root, 'leaf.txt'));
    symlinkSync(join(outside, 'missing'), join(root, 'dangling'), 'junction');
    for (const name of ['../outside/file.txt', '../downloads-other/file.txt', 'leaf.txt', 'dangling/file.txt']) {
      expect(() => resolveJailedSavePath(name, root, 'fallback.txt')).toThrow();
    }
    expect(() => readJailedAttachment(join(root, 'leaf.txt'))).toThrow();
  });

  it('validates default targets and allows genuinely missing write directories', () => {
    symlinkSync(join(outside, 'missing'), join(root, 'fallback.txt'));
    expect(() => resolveJailedSavePath(undefined, root, 'fallback.txt')).toThrow();
    const target = writeJailedFile('nested/file.txt', 'fallback.txt', Buffer.from('safe'));
    expect(readFileSync(target, 'utf8')).toBe('safe');
    expect(target).toBe(join(root, 'nested', 'file.txt'));
  });

  it('allows canonical aliases within the root and rejects non-directory ancestors', () => {
    mkdirSync(join(root, 'folder'));
    symlinkSync(join(root, 'folder'), join(root, 'alias'), 'junction');
    const target = writeJailedFile('alias/file.txt', 'fallback.txt', Buffer.from('safe'));
    expect(target).toBe(join(root, 'folder', 'file.txt'));
    expect(() => assertPathInsideJail(join(target, 'child'), [root], true)).toThrow();
  });
});

describe('registered download/upload handlers', () => {
  it('rejects caller-chosen outside savePath and upload-directory escapes before writing', async () => {
    const handlers: Record<string, Function> = {};
    const imap = { getAttachmentContent: vi.fn(async () => ({ content: Buffer.from('safe'), filename: 'safe.txt', contentType: 'text/plain' })) };
    emailTools({ registerTool: (name: string, _schema: unknown, handler: Function) => { handlers[name] = handler; } } as any,
      imap as any, { resolveAccountId: () => 'test' } as any, {} as any);
    await expect(handlers.imap_download_attachment({ accountId: 'test', folder: 'INBOX', uid: 1, filename: 'safe.txt', savePath: join(outside, 'new.txt'), extractText: false })).rejects.toThrow();
    symlinkSync(outside, join(root, 'uploads'), 'junction');
    await expect(handlers.imap_upload_file({ filename: 'safe.txt', content: Buffer.from('safe').toString('base64') })).rejects.toThrow();
  });
});

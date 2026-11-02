import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

export function resolveDownloadRoot(): string {
  return resolve(process.env.IMAP_DOWNLOAD_DIR?.trim() || join(homedir(), 'Downloads', 'imap-attachments'));
}

export function resolveAttachmentAllowRoots(): string[] {
  return [resolveDownloadRoot(), ...(process.env.IMAP_ATTACHMENT_DIRS || '')
    .split(delimiter).map(part => part.trim()).filter(Boolean).map(part => resolve(part))];
}

function inside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

// Only genuinely absent components may be reconstructed for write targets.
// Dangling links, permission errors and non-directory parents fail closed.
function canonical(candidate: string, allowMissing: boolean): string {
  const absolute = resolve(candidate);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      lstatSync(absolute);
      throw new Error('Unresolved existing path');
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
    }
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonical(parent, true), basename(absolute));
  }
}

export function assertPathInsideJail(candidate: string, roots: string[], allowMissing = false): string {
  try {
    if (!candidate.trim()) throw new Error('Empty path');
    try {
      if (lstatSync(candidate).isSymbolicLink()) throw new Error('Symlink leaf');
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const target = canonical(candidate, allowMissing);
    const store = resolve(homedir(), '.imap-mcp');
    if (inside(resolve(candidate), store) || inside(target, canonical(store, true))) {
      throw new Error('Credential store');
    }
    // The canonical comparison is authoritative. A lexical path cannot
    // override a symlink that resolves outside the configured directory.
    if (!roots.some(root => inside(target, canonical(root, true)))) throw new Error('Outside roots');
    return target;
  } catch {
    // Do not disclose caller-supplied paths or filesystem details to the model.
    throw new Error('Path must resolve inside an allowed directory; symlink leaves and credential-store access are forbidden. Use imap_upload_file or configure IMAP_ATTACHMENT_DIRS.');
  }
}

export function readJailedAttachment(candidate: string): Buffer {
  const target = assertPathInsideJail(candidate, resolveAttachmentAllowRoots());
  const fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Attachment is not a regular file');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function resolveJailedSavePath(savePath: string | undefined, root: string, fallbackName: string): string {
  const candidate = savePath
    ? (isAbsolute(savePath) ? savePath : join(root, savePath))
    : join(root, basename(fallbackName));
  return assertPathInsideJail(candidate, [root], true);
}

export function writeJailedFile(savePath: string | undefined, fallbackName: string, content: Buffer, exclusive = false): string {
  const root = resolveDownloadRoot();
  let target = resolveJailedSavePath(savePath, root, fallbackName);
  mkdirSync(dirname(target), { recursive: true });
  target = assertPathInsideJail(target, [root], true);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NONBLOCK | (exclusive ? constants.O_EXCL : constants.O_TRUNC) | (constants.O_NOFOLLOW || 0);
  const fd = openSync(target, flags, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Download target is not a regular file');
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return target;
}

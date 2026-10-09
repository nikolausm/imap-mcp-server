import { realpathSync, existsSync, lstatSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, normalize, resolve, sep } from 'path';

/**
 * Resolve the shared downloads / attachment staging root.
 * Override with IMAP_DOWNLOAD_DIR.
 */
export function resolveDownloadRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.IMAP_DOWNLOAD_DIR?.trim();
  return resolve(configured && configured.length > 0
    ? configured
    : join(homedir(), 'Downloads', 'imap-attachments'));
}

/**
 * Roots that attachment `path` values may read from.
 *
 * Default: the download root and its `uploads/` subdirectory (where
 * `imap_upload_file` stages files). Extra roots can be added via
 * `IMAP_ATTACHMENT_DIRS` (colon-separated on POSIX, semicolon on Windows).
 */
export function resolveAttachmentAllowRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const downloadRoot = resolveDownloadRoot(env);
  const roots = new Set<string>([downloadRoot, join(downloadRoot, 'uploads')]);

  const extra = env.IMAP_ATTACHMENT_DIRS?.trim();
  if (extra) {
    const delimiter = process.platform === 'win32' ? ';' : ':';
    for (const part of extra.split(delimiter)) {
      const trimmed = part.trim();
      if (trimmed) roots.add(resolve(trimmed));
    }
  }

  return [...roots];
}

/** Absolute path of the local credential store (`~/.imap-mcp`). */
export function resolveCredentialStoreRoot(): string {
  return resolve(homedir(), '.imap-mcp');
}

/**
 * True when `candidate` resolves under `root` (after normalize + resolve).
 * Does not follow symlinks; use {@link assertPathInsideJail} for that.
 */
export function isPathInside(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(normalize(candidate));
  const resolvedRoot = resolve(normalize(root));
  if (resolvedCandidate === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolvedCandidate.startsWith(prefix);
}

function tryRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // Path may not exist yet (download target). Realpath the nearest existing ancestor.
    let current = resolve(p);
    while (current !== resolve(current, '..')) {
      if (existsSync(current)) {
        try {
          const realParent = realpathSync(current);
          const remainder = resolve(p).slice(current.length);
          return resolve(realParent + remainder);
        } catch {
          return resolve(p);
        }
      }
      current = resolve(current, '..');
    }
    return resolve(p);
  }
}

export type PathJailOptions = {
  /** Human-readable label for error messages (e.g. "attachment path", "savePath"). */
  label: string;
  /** When true, refuse paths that land inside ~/.imap-mcp (credential store). */
  rejectCredentialStore?: boolean;
  /** When true, refuse symlink leaves (the final path component is a symlink). */
  rejectSymlinkLeaf?: boolean;
};

/**
 * Resolve `candidate` and assert it is contained in at least one allowlisted root.
 * Returns the absolute (realpath-aware) path on success; throws on violation.
 */
export function assertPathInsideJail(
  candidate: string,
  roots: string[],
  options: PathJailOptions,
): string {
  if (!candidate || !candidate.trim()) {
    throw new Error(`Invalid ${options.label}: path must be non-empty`);
  }

  const trimmed = candidate.trim();
  // Soft-reject obvious credential-store absolute paths early for clearer errors.
  if (options.rejectCredentialStore !== false) {
    const store = resolveCredentialStoreRoot();
    const early = resolve(trimmed);
    if (isPathInside(early, store)) {
      throw new Error(
        `Invalid ${options.label}: reading or writing the credential store (~/.imap-mcp) is not allowed`,
      );
    }
  }

  const resolved = tryRealpath(trimmed);

  if (options.rejectCredentialStore !== false) {
    const store = tryRealpath(resolveCredentialStoreRoot());
    if (isPathInside(resolved, store) || isPathInside(resolve(trimmed), resolveCredentialStoreRoot())) {
      throw new Error(
        `Invalid ${options.label}: reading or writing the credential store (~/.imap-mcp) is not allowed`,
      );
    }
  }

  if (options.rejectSymlinkLeaf) {
    try {
      if (lstatSync(trimmed).isSymbolicLink()) {
        throw new Error(
          `Invalid ${options.label}: symlinked paths are not allowed`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('symlinked')) throw err;
      // ENOENT is fine for write targets that do not exist yet.
    }
  }

  const allowed = roots.some((root) => {
    const realRoot = tryRealpath(root);
    return isPathInside(resolved, realRoot) || isPathInside(resolve(trimmed), resolve(root));
  });

  if (!allowed) {
    const rootsDesc = roots.map((r) => resolve(r)).join(', ');
    throw new Error(
      `Invalid ${options.label}: path must resolve inside an allowlisted directory (${rootsDesc}). ` +
        `Absolute paths outside the jail are rejected. ` +
        `Use imap_upload_file for outbound attachments, or set IMAP_ATTACHMENT_DIRS / IMAP_DOWNLOAD_DIR.`,
    );
  }

  // Prefer the realpath when the leaf exists; otherwise the resolved absolute path.
  return existsSync(trimmed) ? resolved : resolve(trimmed);
}

/**
 * Jail a download `savePath` under the download root.
 * Relative paths are interpreted relative to the download root.
 */
export function resolveJailedSavePath(
  savePath: string | undefined,
  downloadRoot: string,
  fallbackBasename: string,
): string {
  if (!savePath || !savePath.trim()) {
    return join(downloadRoot, fallbackBasename);
  }

  const trimmed = savePath.trim();
  // Relative savePath → under download root (never cwd, which would escape the jail).
  const candidate = isAbsolute(trimmed) ? trimmed : join(downloadRoot, trimmed);

  return assertPathInsideJail(candidate, [downloadRoot], {
    label: 'savePath',
    rejectCredentialStore: true,
  });
}

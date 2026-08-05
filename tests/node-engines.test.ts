import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import semver from 'semver';

// Keeps the Node floor we advertise honest.
//
// npm does NOT check a dependency's `engines` against the floor declared here —
// it checks it against the Node version doing the install. So on a modern
// machine a dependency that requires a newer Node than we promise installs with
// no warning at all, and the mismatch only surfaces as a crash on a user's
// older runtime. That is exactly how #108 happened (`string-width@8` needed
// Node >=20 while we promised >=18) and how PR #134 (`chalk@6`, Node >=22)
// would have slipped in unnoticed.
//
// This walks the runtime dependency tree from the lockfile and asserts that the
// Node version in package.json's `engines` actually satisfies every one of
// them. Dev dependencies are excluded — they only ever run on a maintainer's
// machine and legitimately require newer runtimes.

const ROOT = process.cwd();

const declaredFloor = (): string => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const range = pkg.engines?.node;
  expect(range, 'package.json must declare engines.node').toBeTruthy();
  const min = semver.minVersion(range);
  expect(min, `engines.node "${range}" has no resolvable minimum`).toBeTruthy();
  return min!.version;
};

/** Every non-dev package in the lockfile, with the `engines.node` it declares. */
const runtimeDependencies = (): Array<{ name: string; version: string; engines: string }> => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf-8'));
  const found: Array<{ name: string; version: string; engines: string }> = [];

  for (const [path, meta] of Object.entries<any>(lock.packages)) {
    if (!path || meta.dev) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, path, 'package.json'), 'utf-8'));
    } catch {
      continue; // optional dependency not installed on this platform
    }
    const engines = pkg.engines?.node;
    if (engines) {
      found.push({ name: path.replace(/^.*node_modules\//, ''), version: pkg.version, engines });
    }
  }
  return found;
};

describe('advertised Node floor matches the runtime dependency tree', () => {
  it('package.json declares engines.node', () => {
    expect(declaredFloor()).toBeTruthy();
  });

  it('sanity: the lockfile yields runtime packages that declare engines', () => {
    expect(runtimeDependencies().length).toBeGreaterThan(10);
  });

  it('no runtime dependency requires a newer Node than we advertise', () => {
    const floor = declaredFloor();
    const violations = runtimeDependencies()
      .filter(dep => !semver.satisfies(floor, dep.engines, { includePrerelease: true }))
      .map(dep => `  ${dep.name}@${dep.version} requires node ${dep.engines}`);

    expect(
      violations,
      `package.json advertises node >=${floor}, but these runtime dependencies need more:\n` +
      `${violations.join('\n')}\n\n` +
      'Either raise engines.node (and the CI matrix, AGENTS.md and README with it),\n' +
      'or pin the offending package back via npm "overrides".',
    ).toEqual([]);
  });
});

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Get all dependencies to mark as external
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];

// Build main entry point
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  external,
});

// Build setup entry point
await esbuild.build({
  entryPoints: ['src/setup.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/setup.js',
  external,
});

// Build web server entry point
await esbuild.build({
  entryPoints: ['src/web/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/web/server.js',
  external,
});

// Build CLI entry point — host-installable `imap` binary
// (shebang lives in src/cli.ts and is preserved by esbuild)
await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/cli.js',
  external,
});

console.log('Build complete!');

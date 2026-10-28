import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, SRC_DIR } from './lib/paths.mjs';

export const SAMPLE_FILE = path.join(SRC_DIR, 'content', 'sample-workspace.json');
const ESBUILD = path.join(REPO_ROOT, 'node_modules', '.bin', 'esbuild');

export const canCapture = () => existsSync(ESBUILD);

/** Run the product's own projection code on two small files and return what a workspace would hold. */
export function captureSamples() {
  const bundled = execFileSync(ESBUILD, [
    path.join(REPO_ROOT, 'site-src', 'tools', 'sample-workspace.ts'),
    '--bundle', '--platform=node', '--format=esm', '--log-level=error',
  ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = execFileSync(process.execPath, ['--input-type=module'], { input: bundled, cwd: REPO_ROOT, encoding: 'utf8' });
  return JSON.parse(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(SAMPLE_FILE, `${JSON.stringify(captureSamples(), null, 2)}\n`);
  console.log(`Wrote ${path.relative(REPO_ROOT, SAMPLE_FILE)}`);
}

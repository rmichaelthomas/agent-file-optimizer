import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build.mjs';
import { OUT_DIR, REPO_ROOT, SRC_DIR } from '../tools/lib/paths.mjs';

const GENERATED = ['index.html', '.nojekyll', 'llms.txt', 'agents.json', 'evidence/index.html', 'evidence/BENCHMARKS.md'];

function tinySource(shell, files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'src-'));
  mkdirSync(path.join(dir, 'sections'));
  writeFileSync(path.join(dir, 'shell.html'), shell);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

test('an unresolved token stops the build', async () => {
  const srcDir = tinySource('<html>{{nothing-here}}</html>');
  await assert.rejects(buildSite({ srcDir, outDir: mkdtempSync(path.join(os.tmpdir(), 'out-')), repoRoot: REPO_ROOT, tiny: true }), /unresolved token: \{\{nothing-here\}\}/);
});

test('an include of a file that does not exist stops the build', async () => {
  const srcDir = tinySource('<html>{{include:sections/missing.html}}</html>');
  await assert.rejects(buildSite({ srcDir, outDir: mkdtempSync(path.join(os.tmpdir(), 'out-')), repoRoot: REPO_ROOT, tiny: true }), /unresolved token: \{\{include:sections\/missing\.html\}\}/);
});

test('the build is deterministic and writes only its own files', async () => {
  const first = mkdtempSync(path.join(os.tmpdir(), 'build-a-'));
  const second = mkdtempSync(path.join(os.tmpdir(), 'build-b-'));
  writeFileSync(path.join(first, 'og.png'), 'keep me');
  await buildSite({ outDir: first });
  await buildSite({ outDir: second });
  for (const file of GENERATED) assert.equal(readFileSync(path.join(first, file), 'utf8'), readFileSync(path.join(second, file), 'utf8'), file);
  assert.equal(readFileSync(path.join(first, 'og.png'), 'utf8'), 'keep me');
  assert.ok(!existsSync(path.join(second, 'og.png')));
});

test('site/ is up to date: rebuilding produces the committed files', async () => {
  const fresh = mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  await buildSite({ outDir: fresh });
  for (const file of GENERATED) {
    assert.ok(existsSync(path.join(OUT_DIR, file)), `site/${file} is missing; run npm run site:build`);
    assert.equal(readFileSync(path.join(OUT_DIR, file), 'utf8'), readFileSync(path.join(fresh, file), 'utf8'), `site/${file} is stale; run npm run site:build`);
  }
});

test('the source has no section file that the shell does not include', () => {
  const shell = readFileSync(path.join(SRC_DIR, 'shell.html'), 'utf8');
  for (const name of readdirSync(path.join(SRC_DIR, 'sections'))) assert.ok(shell.includes(`{{include:sections/${name}}}`), `${name} is not included by shell.html`);
});

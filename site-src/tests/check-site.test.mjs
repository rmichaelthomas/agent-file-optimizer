import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSite } from '../tools/check-site.mjs';
import { OUT_DIR } from '../tools/lib/paths.mjs';

const PAGE = (body = '', head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;

function site(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-'));
  for (const [name, body] of Object.entries({ '.nojekyll': '', ...files })) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const rules = async (files) => (await checkSite(site(files))).errors.map((error) => error.split(' ')[0]);

test('a small linked site passes', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<h1 id="a">x</h1><a href="#a">a</a><a href="more.html">m</a>'), 'more.html': PAGE('<a href="./">home</a>') }), []);
});

test('R1: a file that no page links to is reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE(), 'orphan.html': PAGE() }), ['R1']);
});

test('R1: a link to a file that does not exist is reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="gone.html">x</a>') }), ['R1']);
});

test('R2: an anchor with no matching id is reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="#nowhere">x</a>') }), ['R2']);
});

test('R3: a remote or absolute reference to a resource is reported, but a link to the project is allowed', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<img src="https://example.com/a.png" alt="">') }), ['R3']);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="/root-relative">x</a>') }), ['R3']);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="https://github.com/rmichaelthomas/agent-file-optimizer">repo</a>') }), []);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="https://elsewhere.example/x">x</a>') }), ['R3']);
});

test('R3: @import and remote url() in a style block are reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<style>@import "x.css";</style>') }), ['R3']);
  assert.deepEqual(await rules({ 'index.html': PAGE('<style>a{background:url(https://example.com/a.png)}</style>') }), ['R3']);
});

test('R4: any script other than JSON-LD is reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE('<script>alert(1)</script>') }), ['R4']);
  assert.deepEqual(await rules({ 'index.html': PAGE('<script type="application/ld+json">{}</script>') }), []);
});

test('R5: an evidence file whose hash does not match the index is reported', async () => {
  const body = 'report';
  const hash = createHash('sha256').update(body).digest('hex');
  const index = (h) => PAGE(`<table><tr><td><a href="R.md">R.md</a></td><td><code>${h}</code></td></tr></table>`);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="evidence/">e</a>'), 'evidence/index.html': index(hash), 'evidence/R.md': body }), []);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="evidence/">e</a>'), 'evidence/index.html': index('0'.repeat(64)), 'evidence/R.md': body }), ['R5']);
  assert.deepEqual(await rules({ 'index.html': PAGE('<a href="evidence/">e</a><a href="evidence/Other.md">o</a>'), 'evidence/index.html': index(hash), 'evidence/R.md': body, 'evidence/Other.md': 'x' }), ['R5']);
});

test('R6: a page over the size budget is reported', async () => {
  assert.deepEqual(await rules({ 'index.html': PAGE(`<p>${'x'.repeat(401 * 1024)}</p>`) }), ['R6']);
});

test('R7: a site without .nojekyll is reported', async () => {
  const dir = site({ 'index.html': PAGE() });
  const { rmSync } = await import('node:fs');
  rmSync(path.join(dir, '.nojekyll'));
  assert.deepEqual((await checkSite(dir)).errors.map((error) => error.split(' ')[0]), ['R7']);
});

test('crawler files and the images named in meta tags need no link', async () => {
  const head = '<meta property="og:image" content="https://rmichaelthomas.github.io/agent-file-optimizer/og.png">';
  assert.deepEqual(await rules({ 'index.html': PAGE('', head), 'og.png': 'png', 'robots.txt': 'x', 'sitemap.xml': 'x', 'llms.txt': 'x', 'agents.json': '{}', 'favicon.svg': '<svg/>' }), []);
});

test('the committed site passes every rule', async () => {
  const { errors } = await checkSite(OUT_DIR);
  assert.deepEqual(errors, []);
});

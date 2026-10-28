import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { renderInstrumentMap } from '../tools/agent-docs.mjs';
import { OUT_DIR, SOURCE_ROOT } from '../tools/lib/paths.mjs';

const agents = path.join(SOURCE_ROOT, 'agents');

test('the instrument map lists each instrument once with its element and where it is placed', () => {
  const html = '<section id="a" class="chapter" data-ahi="ahi.x.one" data-ahi-element="section"><nav data-ahi="ahi.x.two" data-ahi-element="nav"></nav><nav data-ahi="ahi.x.two" data-ahi-element="nav"></nav></section>';
  const map = renderInstrumentMap(html);
  assert.match(map, /\| `ahi\.x\.one` \| section \| 1 \| a \|/);
  assert.match(map, /\| `ahi\.x\.two` \| nav \| 2 \| a \|/);
});

test('the committed instrument map is what the built page produces', () => {
  const html = readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
  assert.equal(readFileSync(path.join(agents, 'instrument-map.md'), 'utf8'), renderInstrumentMap(html));
});

test('the agent documents exist and do not point at files that are not there', () => {
  for (const name of ['README.md', 'site-brief.md', 'build-and-verify.md', 'extending.md', 'instrument-map.md']) assert.ok(existsSync(path.join(agents, name)), name);
  const repoRoot = path.dirname(SOURCE_ROOT);
  for (const name of readdirSync(agents).filter((file) => file.endsWith('.md'))) {
    const text = readFileSync(path.join(agents, name), 'utf8');
    for (const [, target] of text.matchAll(/`((?:site-src|site|docs|scripts)\/[A-Za-z0-9_./-]+)`/g)) {
      const clean = target.replace(/\/$/, '');
      assert.ok(existsSync(path.join(repoRoot, clean)), `${name} mentions ${target}, which does not exist`);
    }
  }
});

test('no agent document asks anyone to create a root AGENTS.md or CLAUDE.md', () => {
  for (const name of readdirSync(agents).filter((file) => file.endsWith('.md'))) {
    assert.ok(!/create (?:a |an )?(?:root )?(?:AGENTS|CLAUDE)\.md/i.test(readFileSync(path.join(agents, name), 'utf8')), name);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkClaims, loadClaims, renderClaimCard } from '../tools/claims.mjs';
import { REPO_ROOT, SRC_DIR } from '../tools/lib/paths.mjs';

function repoWith(report) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs', 'R.md'), report);
  return root;
}

const claim = (over = {}) => ({
  id: 'demo', title: 'Demo claim', group: 'saves',
  plain: { say: 'It took 1,234 tokens.', holdsWhen: 'Measured on 5 Jan 2026.', doesntTell: 'Nothing about speed.' },
  figures: ['1,234 tokens'], sources: [{ path: 'docs/R.md', needles: ['Measured on 5 Jan 2026'] }], evidence: ['docs/R.md'],
  command: 'npm run demo', ...over,
});

test('a claim whose figures, conditions and numbers are all in its report passes', () => {
  const root = repoWith('Measured on 5 Jan 2026. It took **1,234 tokens**.');
  assert.deepEqual(checkClaims([claim()], root), []);
});

test('a figure that the report does not contain fails', () => {
  const root = repoWith('Measured on 5 Jan 2026. It took 999 tokens.');
  assert.ok(checkClaims([claim()], root).some((issue) => /figure not found: 1,234 tokens/.test(issue.reason)));
});

test('a condition needle that the report does not contain fails', () => {
  const root = repoWith('It took 1,234 tokens.');
  assert.ok(checkClaims([claim()], root).some((issue) => /needle not found/.test(issue.reason)));
});

test('a multi-digit number in the prose that no source contains fails', () => {
  const root = repoWith('Measured on 5 Jan 2026. It took 1,234 tokens.');
  const bad = claim({ plain: { say: 'It took 1,234 tokens, 4567 times.', holdsWhen: 'x', doesntTell: 'y' } });
  assert.ok(checkClaims([bad], root).some((issue) => /number not in any source: 4567/.test(issue.reason)));
});

test('a missing source is reported', () => {
  assert.ok(checkClaims([claim({ sources: [{ path: 'docs/none.md' }] })], repoWith('x')).some((issue) => /missing source/.test(issue.reason)));
});

test('a malformed claim is rejected on load', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-load-'));
  writeFileSync(path.join(dir, 'claims.json'), JSON.stringify([{ id: 'Bad Id' }]));
  assert.throws(() => loadClaims(dir), /bad id/);
});

test('a card shows the five parts, the command, and a way to say it is wrong', () => {
  const html = renderClaimCard(claim(), { base: '' });
  for (const part of ['Claim', 'Holds when', "Doesn't tell you", 'Check it', "Say it's wrong"]) assert.ok(html.includes(`<dt>${part}</dt>`), part);
  assert.ok(html.includes('npm run demo'));
  assert.match(html, /href="evidence\/R\.md"/);
  assert.match(html, /href="https:\/\/github\.com\/rmichaelthomas\/agent-file-optimizer\/issues\/new\?template=bug_report\.md&amp;title=/);
});

test('the claims published on the page all hold against the repository reports', () => {
  const claims = loadClaims(SRC_DIR);
  assert.ok(claims.length >= 5);
  assert.deepEqual(checkClaims(claims, REPO_ROOT), []);
});

test('the claims show results that do not flatter the product at equal weight', () => {
  const claims = loadClaims(SRC_DIR);
  assert.ok(claims.some((entry) => entry.group === 'saves'));
  assert.ok(claims.some((entry) => entry.group === 'no-saving'));
});

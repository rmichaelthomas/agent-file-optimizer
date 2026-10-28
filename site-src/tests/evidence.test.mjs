import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishEvidence } from '../tools/evidence.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs', 'R.md'), 'report body\n');
  return root;
}
const claim = (over = {}) => ({ id: 'a', title: 'Claim A', evidence: ['docs/R.md'], command: 'npm run a', ...over });

test('cited files are copied byte for byte and listed with their SHA-256', async () => {
  const root = fixture();
  const out = path.join(root, 'out');
  await publishEvidence({ repoRoot: root, claims: [claim()], outDir: out });
  assert.equal(readFileSync(path.join(out, 'R.md'), 'utf8'), 'report body\n');
  const index = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(index.includes(createHash('sha256').update('report body\n').digest('hex')));
  assert.ok(index.includes('Claim A') && index.includes('npm run a'));
});

test('a file cited by two claims is listed once, with both claims', async () => {
  const root = fixture();
  const out = path.join(root, 'out');
  await publishEvidence({ repoRoot: root, claims: [claim(), claim({ id: 'b', title: 'Claim B' })], outDir: out });
  const index = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.equal((index.match(/<tr>/g) ?? []).length, 2); // header row + one file
  assert.ok(index.includes('Claim A') && index.includes('Claim B'));
});

test('two evidence files with the same name are refused', async () => {
  const root = fixture();
  mkdirSync(path.join(root, 'other'));
  writeFileSync(path.join(root, 'other', 'R.md'), 'x');
  await assert.rejects(publishEvidence({ repoRoot: root, claims: [claim(), claim({ id: 'b', evidence: ['other/R.md'] })], outDir: path.join(root, 'out') }), /same name/);
});

test('a missing evidence file is an error', async () => {
  const root = fixture();
  await assert.rejects(publishEvidence({ repoRoot: root, claims: [claim({ evidence: ['docs/none.md'] })], outDir: path.join(root, 'out') }), /not found/);
});

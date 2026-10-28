import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLE_FILE, canCapture, captureSamples } from '../tools/capture-samples.mjs';

const committed = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8'));

test('the sample workspace has the five files an agent receives', () => {
  assert.deepEqual(Object.keys(committed.outputs).sort(), ['content.jsonl', 'content.md', 'handoff.md', 'manifest.json', 'tree.txt']);
  assert.match(committed.outputs['handoff.md'], /^# Agent File Optimizer handoff/);
});

test('the samples shown on the page are what the product code prints', { skip: !canCapture() && 'esbuild is not installed (run npm ci)' }, () => {
  assert.deepEqual(captureSamples(), committed);
});

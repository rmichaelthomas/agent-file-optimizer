import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from '../tools/lib/paths.mjs';

const css = readFileSync(path.join(SRC_DIR, 'styles', 'tokens.css'), 'utf8');
const [light, dark] = [css.match(/:root \{([\s\S]*?)\n\}/)[1], css.match(/prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/)[1]];
const parse = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value]));

const channel = (hex, offset) => {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Every text colour against every surface it is drawn on. Text must reach 4.5:1.
const TEXT_ON = [
  ['ink', ['bg', 'panel', 'warn-soft', 'accent-soft', 'code-bg']],
  ['muted', ['bg', 'panel', 'code-bg', 'warn-soft']],
  ['accent', ['bg', 'panel', 'accent-soft']],
  ['warn', ['warn-soft']],
  ['gone', ['bg', 'panel']],
  ['bg', ['accent']],
];

for (const [name, tokens] of [['light', parse(light)], ['dark', parse(dark)]]) {
  test(`${name} theme: every text and surface pair reaches 4.5:1`, () => {
    assert.ok(Object.keys(tokens).length >= 10, `${name} tokens not parsed`);
    for (const [text, surfaces] of TEXT_ON) {
      for (const surface of surfaces) {
        assert.ok(ratio(tokens[text], tokens[surface]) >= 4.5, `${name}: ${text} on ${surface} is ${ratio(tokens[text], tokens[surface]).toFixed(2)}:1`);
      }
    }
  });

  test(`${name} theme: borders and focus rings reach 3:1 against the page`, () => {
    const t = parse(name === 'light' ? light : dark);
    assert.ok(ratio(t.edge, t.bg) >= 3, `edge on bg ${ratio(t.edge, t.bg).toFixed(2)}`);
    assert.ok(ratio(t.focus, t.bg) >= 3, `focus on bg ${ratio(t.focus, t.bg).toFixed(2)}`);
    assert.ok(ratio(t.focus, t.panel) >= 3, `focus on panel ${ratio(t.focus, t.panel).toFixed(2)}`);
  });
}

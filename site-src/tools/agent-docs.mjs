import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, SOURCE_ROOT } from './lib/paths.mjs';

/** Which AllHereHTML instrument is placed where, read from the data-ahi attributes of the built page. */
export function renderInstrumentMap(html) {
  const marks = [...html.matchAll(/<([a-z0-9]+)\b([^>]*)>/g)];
  let chapter = 'header';
  const placements = new Map();
  for (const [, , attributes] of marks) {
    const chapterId = /\bclass="chapter"/.test(attributes) ? /\bid="([^"]+)"/.exec(attributes)?.[1] : null;
    if (chapterId) chapter = chapterId;
    if (/\bclass="hero"/.test(attributes)) chapter = 'hero';
    const id = /\bdata-ahi="([^"]+)"/.exec(attributes)?.[1];
    if (!id) continue;
    if (/\bclass="chapter"/.test(attributes) && id === 'ahi.navigation-journeys.jump-point') continue;
    const element = /\bdata-ahi-element="([^"]+)"/.exec(attributes)?.[1] ?? '';
    if (!placements.has(id)) placements.set(id, { element, count: 0, where: [] });
    const entry = placements.get(id);
    entry.count += 1;
    if (!entry.where.includes(chapter)) entry.where.push(chapter);
  }
  const jump = (html.match(/data-ahi="ahi\.navigation-journeys\.jump-point"/g) ?? []).length;
  const rows = [...placements].sort(([a], [b]) => a.localeCompare(b)).map(([id, { element, count, where }]) => `| \`${id}\` | ${element} | ${count} | ${where.join(', ')} |`);
  rows.push(`| \`ahi.navigation-journeys.jump-point\` | section | ${jump} | every chapter |`);
  return `# Instrument map

Generated from \`site/index.html\` by \`site-src/tools/agent-docs.mjs\`. Do not edit by hand; run \`npm run site:build\` and \`node site-src/tools/agent-docs.mjs\`. A test fails if this file is stale.

Each instrument is authored to its AllHereHTML registry contract (semantic element, native interaction, fallback) and marked with a \`data-ahi\` attribute. None is vendored.

| Instrument | Element | Placements | Where |
| --- | --- | ---: | --- |
${rows.join('\n')}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = await readFile(path.join(OUT_DIR, 'index.html'), 'utf8');
  await writeFile(path.join(SOURCE_ROOT, 'agents', 'instrument-map.md'), renderInstrumentMap(html));
  console.log('Wrote site-src/agents/instrument-map.md');
}

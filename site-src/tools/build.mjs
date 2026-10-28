import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, SRC_DIR, OUT_DIR } from './lib/paths.mjs';
import { escapeHtml, loadClaims, renderClaimCard } from './claims.mjs';
import { publishEvidence } from './evidence.mjs';
import { renderAgentsJson } from './agents-surface.mjs';

const STYLES = ['tokens', 'base', 'layout', 'components', 'print'];
const TOKEN = /\{\{([a-z][a-z-]*)(?::([^{}]+))?\}\}/g;
const STATUS = { works: ['tag-works', 'Works'], original: ['tag-no', 'Original only'], 'not-yet': ['tag-no', 'Not yet'] };

const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const json = async (srcDir, name) => JSON.parse(await readFile(path.join(srcDir, 'content', name), 'utf8'));

async function readStyles(srcDir) {
  const parts = [];
  for (const name of STYLES) {
    const file = path.join(srcDir, 'styles', `${name}.css`);
    if (existsSync(file)) parts.push((await readFile(file, 'utf8')).trim());
  }
  return parts.join('\n');
}

/**
 * Assemble the deployed site from site-src/src into outDir: index.html, evidence/, llms.txt,
 * agents.json and .nojekyll. Other files already in outDir (og.png, favicon, robots, sitemap) are left alone.
 */
export async function buildSite({ srcDir = SRC_DIR, outDir = OUT_DIR, repoRoot = REPO_ROOT, tiny = false } = {}) {
  const shell = await readFile(path.join(srcDir, 'shell.html'), 'utf8');
  const css = await readStyles(srcDir);
  const claims = existsSync(path.join(srcDir, 'claims.json')) ? loadClaims(srcDir) : [];
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const cache = new Map();
  const read = async (relative) => {
    if (!cache.has(relative)) cache.set(relative, await readFile(path.join(srcDir, relative), 'utf8'));
    return cache.get(relative);
  };

  const dynamic = {
    'faq-html': async () => (await json(srcDir, 'faq.json')).map(({ q, a }) => `<h3>${escapeHtml(q)}</h3>\n<p>${escapeHtml(a)}</p>`).join('\n'),
    'faq-jsonld': async () => JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: (await json(srcDir, 'faq.json')).map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    }, null, 2),
    'software-jsonld': async () => JSON.stringify(await json(srcDir, 'software.json'), null, 2),
    'formats-rows': async () => (await json(srcDir, 'formats.json')).map(({ input, gets, status }) => {
      const [tagClass, label] = STATUS[status];
      return `<tr><th scope="row">${escapeHtml(input)}</th><td>${gets}</td><td><span class="tag ${tagClass}">${label}</span></td></tr>`;
    }).join('\n'),
    'sample-file': async (name) => escapeHtml((await json(srcDir, 'sample-workspace.json')).outputs[name] ?? (() => { throw new Error(`no sample file ${name}`); })()),
    'sample-input': async (name) => escapeHtml((await json(srcDir, 'sample-workspace.json')).inputs.find((input) => input.path === name)?.text ?? (() => { throw new Error(`no sample input ${name}`); })()),
    'claims-list': async () => claims.map((claim) => `- ${claim.title}. ${claim.plain.say} Holds when: ${claim.plain.holdsWhen} Does not tell you: ${claim.plain.doesntTell}`).join('\n'),
  };

  async function resolve(text, report) {
    let current = text;
    for (let pass = 0; pass < 8; pass += 1) {
      const tokens = [...current.matchAll(TOKEN)].filter(([, name]) => name !== 'css');
      if (tokens.length === 0) break;
      const replacements = new Map();
      for (const [whole, name, argument] of tokens) {
        if (replacements.has(whole)) continue;
        let value;
        if (name === 'include' && argument) value = existsSync(path.join(srcDir, argument)) ? (await read(argument)).trim() : undefined;
        else if (name === 'claim' && argument) value = claimById.has(argument) ? renderClaimCard(claimById.get(argument)) : undefined;
        else if (name === 'report' && argument) value = report[argument];
        else if (dynamic[name]) value = await dynamic[name](argument);
        if (value === undefined) throw new Error(`unresolved token: ${whole}`);
        replacements.set(whole, value);
      }
      current = current.replace(TOKEN, (whole, name) => (name === 'css' ? whole : replacements.get(whole)));
    }
    const left = [...current.matchAll(TOKEN)].find(([, name]) => name !== 'css');
    if (left) throw new Error(`unresolved token: ${left[0]}`);
    return current.replace('{{css}}', () => css);
  }

  // The footer states the page's own weight; render again until the rounded figures stop moving.
  let report = { weight: '0 KB' };
  let html = await resolve(shell, report);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = { weight: kb(Buffer.byteLength(html)) };
    if (next.weight === report.weight) break;
    report = next;
    html = await resolve(shell, report);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), html);
  await writeFile(path.join(outDir, '.nojekyll'), '');
  if (!tiny) {
    await rm(path.join(outDir, 'evidence'), { recursive: true, force: true });
    await publishEvidence({ repoRoot, claims, outDir: path.join(outDir, 'evidence') });
    await writeFile(path.join(outDir, 'llms.txt'), await resolve(await readFile(path.join(srcDir, 'llms.template.txt'), 'utf8'), report));
    await writeFile(path.join(outDir, 'agents.json'), renderAgentsJson({ claims, formats: await json(srcDir, 'formats.json'), faq: await json(srcDir, 'faq.json') }));
  }
  return { bytes: Buffer.byteLength(html), weight: report.weight };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bytes } = await buildSite();
  console.log(`Built site/ (index.html ${bytes} bytes)`);
}

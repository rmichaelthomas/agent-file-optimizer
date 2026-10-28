import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from './claims.mjs';

/**
 * Copy the files that claims cite into `outDir` (flat, by file name) and write `index.html`
 * listing each with its size and SHA-256, the claims that cite it, and how to reproduce it.
 */
export async function publishEvidence({ repoRoot, claims, outDir }) {
  const bySource = new Map();
  for (const claim of claims) {
    for (const source of claim.evidence) {
      if (!bySource.has(source)) bySource.set(source, { titles: [], commands: [] });
      const record = bySource.get(source);
      record.titles.push(claim.title);
      if (claim.command) record.commands.push(claim.command);
    }
  }

  const byName = new Map();
  for (const source of bySource.keys()) {
    const name = path.basename(source);
    if (byName.has(name)) throw new Error(`two evidence files have the same name "${name}": ${byName.get(name)} and ${source}`);
    byName.set(name, source);
  }

  await mkdir(outDir, { recursive: true });
  const entries = [];
  for (const [name, sourcePath] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    let bytes;
    try {
      bytes = await readFile(path.join(repoRoot, sourcePath));
    } catch {
      throw new Error(`evidence file not found: ${sourcePath}`);
    }
    await writeFile(path.join(outDir, name), bytes);
    const record = bySource.get(sourcePath);
    entries.push({
      name,
      sourcePath,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      cites: [...new Set(record.titles)],
      commands: [...new Set(record.commands)],
    });
  }

  const rows = entries.map((entry) => `<tr>
<td><a href="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</a></td>
<td class="num">${entry.bytes.toLocaleString('en-US')}</td>
<td><code>${entry.sha256}</code></td>
<td><ul>${entry.cites.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul></td>
<td>${entry.commands.map((command) => `<pre>${escapeHtml(command)}</pre>`).join('')}</td>
</tr>`).join('\n');

  await writeFile(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent File Optimizer: the files behind the numbers</title>
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>
:root{color-scheme:light dark;--bg:#f7f4ee;--ink:#1f2328;--muted:#4a5159;--line:#d9d3c7;--accent:#33541e;--focus:#0b4f9c}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--ink:#f0efe9;--muted:#c4c8cf;--line:#3a3f47;--accent:#b9de8a;--focus:#9ec8ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 20px 56px}
h1{font-size:clamp(1.8rem,5vw,2.6rem);line-height:1.12;letter-spacing:-.02em;margin:.4em 0}
a{color:var(--accent);text-underline-offset:3px}a:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:4px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
ul{margin:0;padding-left:1.1em}
pre{margin:0 0 8px;font:.8em/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.num{text-align:right;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<main>
<p><a href="../">← Agent File Optimizer</a></p>
<h1>The files behind the numbers</h1>
<p>Every figure on the project page comes from the report below. It is a byte-for-byte copy of a file in the repository, listed with its size and SHA-256. Check a hash with <code>shasum -a 256 FILE</code>. The measurements describe named workloads on one date; read each report's own limits before you rely on a number.</p>
<div class="table-wrap">
<table>
<thead><tr><th scope="col">File</th><th scope="col">Bytes</th><th scope="col">SHA-256</th><th scope="col">Cited by</th><th scope="col">Reproduce with</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</main>
</body>
</html>
`);
  return { entries };
}

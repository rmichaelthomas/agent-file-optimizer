# Build and verify

All commands run from the repository root with Node 22. `npm ci` first if `node_modules` is missing (the sample test needs `esbuild`, which comes with the project's dependencies).

| Command | What it does |
| --- | --- |
| `npm run site:build` | Rebuilds `site/` from `site-src/`: `index.html`, `evidence/`, `llms.txt`, `agents.json`, `.nojekyll`. |
| `npm run site:test` | Runs `site-src/tests/*.test.mjs`. |
| `npm run site:check` | Runs `scripts/check-site.mjs`: the older rules (metadata, no scripts or trackers, banned phrases, FAQ markup equals the visible FAQ, social images) plus R1 to R7 from `site-src/tools/check-site.mjs`. Pages runs this before it deploys. |
| `npm run site:preview` | Serves `site/` at http://127.0.0.1:8788/agent-file-optimizer/, the way Pages does, and returns 404 for everything else. |
| `node site-src/tools/capture-samples.mjs` | Re-captures `site-src/src/content/sample-workspace.json` from the product's own code. Run it if the projections change. |
| `node site-src/tools/agent-docs.mjs` | Regenerates `site-src/agents/instrument-map.md`. |

## Order of a content change

1. Edit the source (`sections/`, `styles/`, `claims.json`, `content/`).
2. `npm run site:build`.
3. `npm run site:test` then `npm run site:check`.
4. Look at it with `npm run site:preview`, at 320 px and 1280 px, in light and dark, with the page printed to PDF.
5. Commit the source and the regenerated `site/` together. Merging to `main` deploys.

## What the checks enforce

- **R1** every file in `site/` is linked from a page, or is a file crawlers fetch by name (`robots.txt`, `sitemap.xml`, `llms.txt`, `agents.json`, `favicon.svg`), or a social image named in a meta tag.
- **R2** every `#anchor` resolves. **R3** no remote resource, no absolute path, no link outside the project, the author's site, and Cloudflare's deploy page for this repository. **R4** the only scripts are JSON-LD. **R5** the evidence hashes match. **R6** each page is at most 400 KB. **R7** `.nojekyll` exists.
- `build.test.mjs` fails if `site/` is stale. `claims.test.mjs` fails if a figure is not in its report. `samples.test.mjs` fails if the sample files are not what the product code prints. `contrast.test.mjs` fails if a text and surface pair drops under 4.5:1 in either theme. `page.test.mjs` fails on structure: one `h1`, one `main`, labelled navigation, no duplicate ids, every instrument is the element its contract names, no filler text.

## Deployment

Unchanged: `.github/workflows/pages.yml` runs `scripts/check-site.mjs` and uploads `site/` on a push to `main` that touches `site/**`. Do not change the workflow or the Pages settings.

## Browser checks worth repeating

Network log (the page and `favicon.svg` only), console (empty), tab order (the skip link first), no horizontal overflow at 320 to 1920 px, forced colors, print to PDF, dark mode. The last run and what it did not cover are in `site-src/qa/RESULTS.md`.

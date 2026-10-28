# Agent documents for the public site

Start here if you are an agent asked to change the project's public page at https://rmichaelthomas.github.io/agent-file-optimizer/. These documents live in `site-src/agents/`, not in a root `AGENTS.md` or `CLAUDE.md`. Do not create or edit one of those without the owner's permission.

| Document | Read it when |
| --- | --- |
| [design.md](design.md) | You want the design as it was approved: the idea, goals, anti-goals, the instrument table, and the calls that were made. |
| [site-brief.md](site-brief.md) | You need to know what the page is for, its voice, and what would make it a failure. |
| [build-and-verify.md](build-and-verify.md) | You are changing the page and need the commands and the order to run them in. |
| [extending.md](extending.md) | You are adding a figure, a section, an instrument, or a format row. |
| [instrument-map.md](instrument-map.md) | You want to know which AllHereHTML instrument is used where (generated). |

## The layout in one screen

- `site-src/src/` is the source: `shell.html`, `sections/NN-name.html`, `styles/*.css`, `claims.json`, `content/*.json`, `llms.template.txt`.
- `site-src/tools/` is the dependency-free Node 22 build and its checks. `site-src/tests/` has one test file per tool or surface.
- `site/` is **generated and committed**. GitHub Pages publishes it through `.github/workflows/pages.yml`. `site/og.png`, `favicon.svg`, `robots.txt` and `sitemap.xml` are committed by hand; the build does not touch them.
- Never edit `site/index.html`, `site/llms.txt`, `site/agents.json` or `site/evidence/` by hand. Change the source and run `npm run site:build`.

## Rules that are easy to break

1. A figure never appears bare in a section file. It goes in `claims.json` and renders as a receipt, and `docs/BENCHMARKS.md` must contain the figure and the conditions, or the tests fail.
2. No scripts. The only `<script>` allowed is JSON-LD data. The page makes no requests to other sites.
3. All paths are relative. The page lives under `/agent-file-optimizer/`; a leading `/` breaks it.
4. AllHereHTML is credited once, in the footer. The page has no section about it.
5. Do not touch `.github/workflows/pages.yml` or the Pages settings. Deployment is unchanged.
6. Use `python3`, never `python`. Quote test globs: `node --test 'site-src/tests/*.test.mjs'`.

Where the method came from: AllHereHTML's landing-page playbook (in that repository's docs/agents folder), Route C, and the Guion site it was written from.

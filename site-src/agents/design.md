# Landing site on AllHereHTML: design

Status: approved by the owner in conversation, 2026-10-28 ("Go", then "carry on through build, QA, and the PR in one run"). Followed the method in AllHereHTML's landing-page playbook (Route C, lighter than the Guion site it was written from). This repository's `.gitignore` excludes the docs/superpowers folder, so the design lives here with the other agent documents. The build was done test first, in this order: samples, claims, evidence, build, checker, content and styles, wiring, agent documents, browser QA.

## Intent

The public page at https://rmichaelthomas.github.io/agent-file-optimizer/ is rebuilt so that its design is composed from AllHereHTML instruments, and so that every figure on it is backed by a receipt. The deployment does not change: GitHub Pages keeps publishing `site/` through `.github/workflows/pages.yml`. The owner asked for no branch move and no publish script.

The page keeps its URL, title, metadata, structured data, `og.png`, favicon, `robots.txt`, `sitemap.xml` and attribution line. What changes is how it is made and how it is arranged.

## The idea

The product is about time. A link is handed over, read, and gone. The page is organised around the life of a link, and the page shows rather than describes:

- the **window** is drawn to scale (1, 6 and 12 hours as bars of proportional length), ending in the status the link then returns, `410`;
- **what the agent receives** is real: the page lets you open each file of a two-file sample workspace, and every byte shown was printed by the product's own projection code (`site-src/tools/capture-samples.mjs`), not typed;
- **where it stops** is as prominent as what works: the formats table gives Works, Original only and Not yet equal weight, and the receipts include the result that does not flatter the product (no saving on plain text and code).

## Goals

1. Someone who has never seen the project can say what it does, what it will not do, and what it costs them, in under a minute.
2. Every number on the page is a receipt: claim, when it holds, what it does not tell you, how to check it, how to say it is wrong.
3. Works with scripts off, in light and dark, at 320 px, in forced colors and in print.
4. The existing quality bar stays: `scripts/check-site.mjs` keeps passing, with its rules intact.

## Non-goals and anti-goals

- No Plain/Developer toggle, no playground, no Wasm, no script. There is one audience.
- No section about AllHereHTML. The only credit is a footer line: "Page made with AllHereHTML".
- No hosted-service implication, no "any file", no general "saves N% of tokens" claim. A failure even if everything works: a figure that sounds broader than its report.
- Not a rewrite of the product's copy. The existing wording was already scoped and is reused where it is correct.
- No change to the Worker, the tests under `tests/`, the Pages workflow or the Pages settings.

## Layout

```
site-src/            source of the site (not deployed)
  src/shell.html, sections/NN-name.html, styles/*.css, claims.json, content/*.json, content/sample-workspace.json
  tools/             build, claims, check-site, evidence, serve, capture-samples, lib/paths
  tests/             node:test, one file per tool or surface
  agents/            documents for agents working on the site
  qa/                browser QA results and screenshots
site/                GENERATED and committed; the only thing Pages publishes
  index.html, evidence/, llms.txt, agents.json, .nojekyll
  og.png, favicon.svg, robots.txt, sitemap.xml   (committed static files; the build does not touch them)
```

Generated files are committed so that deploys need no build step, and a test rebuilds and fails if `site/` is stale. `site/index.html` is the one page; `evidence/index.html` is a plain index of the cited file with its SHA-256.

## Instruments

Chosen by fit, with no coverage target. Authored to the registry contracts (semantic element, native interaction, fallback, `data-ahi` attribute). Nothing is vendored from AllHereHTML, because this repository is public and AllHereHTML has no licence file or public remote yet.

| Where | Instrument | Why it fits |
|---|---|---|
| Page title | typography-reading.variable-title | Scales within bounds on a phone |
| Chapter navigation | navigation-journeys.chapter-rail | A normal `nav` of anchors |
| The life of a link | motion-time.time-ribbon | An ordered timeline that reads without motion |
| Three steps | teaching-guidance.step-card | One bounded action each |
| Files of a workspace | reveals-discoveries.tabbed-scene | Native disclosures, no script tabs |
| The handoff note | teaching-guidance.annotated-example | An example, then what to notice |
| Formats | relationships-diagrams.comparison-bridge | A captioned table with headers |
| Limits | publications-objects.reference-sheet | Terms and values in a definition list |
| Link open vs ended | motion-time.state-transition | Named before/after states in a disclosure |
| Revoke and retry | relationships-diagrams.cause-and-effect-ladder | A causal sequence with a visible consequence |
| Bearer warning | annotation-evidence.context-callout and typography-reading.pull-quote | Supplementary note; the line to remember |
| Sources | annotation-evidence.source-trail | An ordered list of where numbers come from |
| Alternatives | relationships-diagrams.comparison-bridge | Two perspectives, one table |
| Ways to run it | reveals-discoveries.accordion | One titled passage each |

## Receipts

Six claims in `claims.json`, each rendered as a five-part card and guarded by `checkClaims`: every figure, every stated condition and every multi-digit number in a claim must appear in `docs/BENCHMARKS.md`, or the tests fail. The favourable and unfavourable results sit side by side. "Say it's wrong" links to the repository's issue form, not to a private address. `docs/BENCHMARKS.md` is published under `evidence/` with its hash, and each card carries the command that reproduces it.

## Checks

- `site-src/tests`: build is deterministic and `site/` is fresh; claims guard; the sample files equal what the product prints (skips cleanly without esbuild); FAQ structured data equals the visible FAQ; no filler text or fixed AllHere labels leak; contrast of every token pair is at least 4.5:1.
- `scripts/check-site.mjs` (run by Pages and CI): its existing rules, plus the structural rules R1 to R7 from the Guion site (every file linked, anchors resolve, no remote references, only JSON-LD scripts, evidence hashes match, weight budget, `.nojekyll`).
- Browser QA on the built page, served at the real subpath: network log, scripts disabled, widths 320 to 1920, reduced motion, forced colors, print, structure, contrast, console, tab order. Results, failures included, in `site-src/qa/RESULTS.md`.

## Calls I made (the owner can overrule)

- Source in `site-src/` and output in `site/`, so the Pages workflow needs no change.
- Authored, not vendored (see Instruments).
- `node:test` for site tests, run in CI as `npm run site:test`; the vitest suite is untouched. Adding that CI step is the only workflow change.
- Light and dark themes kept; the warm paper and green identity kept so the page still looks like the same project.
- The H1 becomes the repository tagline, "Hand files to an agent, then let them expire", which matches `og:title` and the repository description.
- Sample workspace files are illustrative inputs (a two-row CSV and a one-line note) run through the real code. The page says so.

## Out of scope for this change

Firefox, WebKit, screen reader and real-zoom checks are not run; the QA file says so.

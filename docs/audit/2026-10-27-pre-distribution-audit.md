# Agent File Optimizer pre-distribution audit — execution plan

Date: 2026-10-27 · Tree: `a8122e9` (main) · Full report with scorecard, personas, and method: https://claude.ai/artifact/VpKmbi7ZfV3JjN38EJtVf6 (private; shared only by the owner).

This file is the part a coding agent executes. Phases are a real sequence. Every task names files, the change, and the check that proves it is done. Do not modify files outside those named without stopping to ask. Keep these green after every task:

```
npm test
npm run typecheck
npm run site:check
npm run deploy:dry
```

**Never run `npx wrangler deploy` (without `--dry-run`), `npx wrangler secret put`, `wrangler d1 ... --remote`, or any GitHub Pages or Cloudflare settings change.** Live deployment needs the owner's explicit authorization for that specific change. Tasks marked STOP need the owner before the change is made.

Verdict: ready for the owner and a few people who will read the stated limits and run their own copy now. Ready for a small public group of self-hosters after Phase 0 and Phase 1. Not ready for strangers using a hosted instance, and the project does not offer one.

**Read this before touching anything.** Two framings govern this plan:

1. **Unbuilt is not dead.** Placeholder surfaces, unpopulated states, and anything specified but not yet built are intentional design or build debt. Never remove them. Where a task touches one, give the unpopulated state one honest line of copy and leave the surface in place. This product currently has no placeholder surfaces; the rule applies to anything added later.
2. **Locked decisions are decisions.** The project's recorded non-negotiables (the README's stated limits, PRIVACY.md, the admin-token gate, the handoff format in `src/projections.ts`) are audited against, never argued with. Where a task touches one, it says STOP and asks the owner.

## Status (updated on branch `pre-distribution-audit`)

| Task | State |
|---|---|
| 0.1 Landing headers | Done. Test in `tests/ui.test.ts`. Live after the next deploy. |
| 0.2 Error logging | Done, with one correction: the plan's `slice(0, 3)` would have logged the share token for `/s/<token>`, so the log uses the route class `/s`. Also fixed a bug found by the test: route handlers were returned without `await`, so their errors skipped the 500 handler. |
| 0.3 413 message | Done. |
| 1.1 Boundary contrast | Done. New `--edge` token (landing `#7c869e`, site light `#857d6e`, site dark `#7a828c`), all 3:1 or better against their surfaces (computed with `contrast.py --pairs`). Decorative card borders are unchanged. Brand owner may still choose other values; the check is the ratio. |
| 1.2 README quick start | Superseded: the schema now creates itself, `npm run deploy` handles login. `jq` note added. |
| 1.3 Config ID | Done earlier: the real D1 ID was removed from `wrangler.jsonc`. It remains in history of `a8122e9`; it is an identifier, not a credential. |
| 1.4 Entry and browser tests | Done. `tests/entry.test.ts`, `npm run browser-check` (18 checks), both in CI. |
| 1.5 Setup smoke test in CI | Done earlier (`npm run smoke`). |
| 1.6 Zip lying about size | Verified: fflate allocates by the declared size and truncates, so memory is bounded. Test added. |
| 2.1 Projection refresh | Done. The five projection objects are overwritten in place (no delete first), and the refresh repeats if the file list changed while writing. |
| 2.2 Purge bound | Done. 200 per pass, oldest first. |
| 2.3 README first line | Done with the owner's approved wording. |
| 2.4 HTML rendering of the handoff | Done, owner approved. `src/render.ts`; only the base share link, only for a browser navigation (`Sec-Fetch-Dest: document`). `/handoff.md` and agents get the Markdown unchanged. |
| 2.5 Changelog, tag, template | Done. `v0.1.0` is tagged on `a8122e9` and pushed. |
| 2.6 Pin Actions | Done. |
| 2.7 Private vulnerability reporting | Enabled on the owner's instruction; `gh api` reports `enabled: true`. |
| 3.1 Indentation | Done. |
| 3.2 Landing intent line | No change, as planned. |

---

## Phase 0 — Live-path fixes (before the next tester)

These touch code that is deployed and reachable now: the API Worker at `agent-file-optimizer.thomasbuild.workers.dev` runs commit `a8122e9`'s `src/`.

### 0.1 Add framing and content-type protection to the landing page
- `src/index.ts` line 9: the landing response currently sets only `content-type` and `cache-control`. Change the headers object to:
  `"content-type": "text/html; charset=utf-8"`, `"cache-control": "no-store"`, `"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`, `"x-frame-options": "DENY"`, `"x-content-type-options": "nosniff"`, `"referrer-policy": "no-referrer"`.
- Reason: the admin-token field on this page could be overlaid in a frame. The policy is a restriction only; the page's inline script and style still run.
- Done when: `tests/ui.test.ts` gains a test that imports the Worker default export from `src/index.ts`, calls `fetch(new Request("https://x.test/"))` with an env of `{}`, and asserts `frame-ancestors 'none'` and `x-frame-options` equal `DENY` in the response headers. `npm test` passes.
- After the owner authorizes a deploy: `curl -sD - -o /dev/null https://agent-file-optimizer.thomasbuild.workers.dev/` shows both headers. STOP before deploying.

### 0.2 Log internal errors without content
- `src/app.ts` lines 328–332: the outer `catch` returns `errorResponse(500, "The workspace could not be processed.")` with no log. Before the `return`, add `console.error(\`request failed: ${request.method} ${url.pathname.split("/").slice(0, 3).join("/")}/…: ${error instanceof Error ? error.name : "unknown error"}\`);`. Log the route prefix only: never the full path, because share paths carry bearer tokens.
- Done when: a test in `tests/api.test.ts` forces a 500 (for example, by passing a store whose `get` throws), spies on `console.error`, and asserts the logged string contains no share token and no upload token.

### 0.3 Replace internal jargon in the 413 message
- `src/app.ts` line 160: change the text after `each.` from "Larger files will use the direct-upload/scanned path in a later adapter." to "Split larger files into separate uploads, or use the original-only route by sharing them another way."
- Done when: `grep -rn "direct-upload" src` returns nothing, and `tests/api.test.ts` still passes.

---

## Phase 1 — Before public distribution

### 1.1 Meet 3:1 for input and disclosure boundaries (WCAG 1.4.11)
- Landing: `src/ui.ts` `:root` token `--line:#3a4152`. Measured against the field `#101218` it scores 1.83:1, and against the panel `#1b1e27` 1.63:1. Inputs and selects need a boundary a sighted user can identify.
- Site: `site/index.html` `:root` `--line:#d9d3c7` scores 1.49:1 against `--panel` `#ffffff` for `details` disclosures. Dark `--line:#3a3f47` scores 1.69:1 against `--bg` `#15171a`.
- STOP: the token values are a brand decision. Ask the owner for the boundary color. The acceptance check is the ratio, not the hex.
- Done when: `python3 /Users/rmichaelthomas/.claude/skills/rmt-product-audit/scripts/contrast.py --pairs <file>` reports PASS (≥ 3.00) for `<boundary> <field-bg>` and `<boundary> <panel>` on the landing, and for `<boundary> <bg>` on the site in both themes. Use hex without the `#` in the pairs file (the script skips lines beginning with `#`).

### 1.2 Make the README's local quick start work from a fresh clone
- `README.md` "Try it locally" (around line 60): after `npm install`, add a step:
  `npx wrangler d1 migrations apply agent-file-optimizer --local`.
  Without it, the first request fails with `no such table: workspaces` (verified on a fresh persist directory).
- `README.md` "Self-hosting" step 1 (around line 100): add before the first command: `npx wrangler login`. The current steps run remote commands with no login step.
- `README.md` "Try it locally" curl example: add "Requires `jq`" above the block.
- Done when: in a new directory, a fresh clone of the repository following only the README's local steps returns `201` from the upload call and serves `handoff.md`. Record the commands and status codes in the PR.

### 1.3 Decide what the repository's wrangler config should contain (STOP)
- `wrangler.jsonc` line 22 holds the owner's real D1 `database_id`. The README at line 107 says to replace the placeholder, but the committed file no longer has one, so a forker's first deploy targets an ID outside their account.
- STOP: the owner decides between (a) keeping the real ID, which is an identifier and not a credential, and documenting that forks must replace it, or (b) restoring the placeholder in the public file and keeping the real ID in an untracked local override. Do not change the file until the owner chooses.
- Done when: the README's steps and `wrangler.jsonc` agree, and `npm run deploy:dry` still passes.

### 1.4 Test the Worker entry and the browser path in CI
- Add `tests/entry.test.ts`: imports the default export of `src/index.ts`, checks `GET /` returns 200 HTML, `GET /healthz` returns `{ok:true}`, and an unknown route returns 404 JSON.
- Add a Playwright-based check under `tests/browser/` for the landing flow: select a file, create, copy, revoke. Run it from `.github/workflows/ci.yml` after `npm test`, using `npx playwright install --with-deps chromium`. The script in this audit's scratchpad was the reference.
- Done when: CI's run log shows the entry tests and the browser check passing on a pull request.

### 1.5 Add a setup smoke test to CI
- `.github/workflows/ci.yml`: add a job that runs `npx wrangler dev --port 8787 &`, applies local migrations, and runs the README's curl sequence (create, upload, read `handoff.md`). It fails if any status is not `201`/`200`.
- Done when: a deliberate break (remove the migration step) turns the job red.

### 1.6 Verify the zip-member expansion limit
- `src/parsers/native.ts` lines 229–241 select archive members by declared size (`file.originalSize`). Declared sizes can be wrong.
- Add `tests/archive.test.ts` case: a ZIP whose one member declares 1 KB and inflates to 60 MB. Assert the parser omits it or truncates it and reports a warning, and that the Worker does not exceed a fixed output budget (define it as the existing `archiveBytesLimit` of 25 MB applied to inflated output, not only declared size).
- If the test fails, fix by counting inflated bytes during extraction. Done when the new test passes.

---

## Phase 2 — Should close (a workaround exists)

### 2.1 Serialize projection refresh per workspace
- `src/lifecycle.ts` lines 92–110: `refreshProjections` reads every original on every upload and deletes the projections prefix before rewriting. Two uploads to one workspace can interleave, so a reader may get 404 for `handoff.md` during the rewrite.
- Change: an in-memory lock does not hold across Worker isolates, so write projections to a versioned prefix (`projections/<version>/…`), update the workspace's current version last, then delete old versions. Readers resolve the current version first.
- Done when: a test uploads two files concurrently, then asserts every projection read returns 200 at every point, and no objects remain under old versions after completion.

### 2.2 Bound the scheduled purge
- `src/store.ts` D1 `listNeedingPurge` returns every pending workspace in one query, and `expireDue` in `src/lifecycle.ts` purges them all in one invocation. Add `LIMIT 200` to the SQL and return at most 200 rows. Keep `purged_at` ordering so the oldest pending workspaces go first.
- Done when: a test with 500 expired workspaces shows that one `expireDue` call purges at most 200 and the next call purges the rest.

### 2.3 Replace the README's first line with plain words (copy, owner approves)
- `README.md` line 3 currently reads "A small, self-hostable Cloudflare Worker for turning a file handoff into a temporary agent context workspace." Propose to the owner: "Turn files into a temporary, readable link for an agent or a collaborator." STOP until the owner approves the wording.
- Done when: the approved line replaces the old one and `site:check` still passes.

### 2.4 Make the handoff readable to a person (STOP: format contract)
- A share link opened in a browser displays raw Markdown: literal `**` and backtick markers, and an ISO timestamp (verified in Chrome; screenshot in the audit scratchpad).
- Do not change the Markdown that agents receive. STOP: the owner decides whether to serve an HTML rendering to browsers (for example, when `Accept` contains `text/html`) or to leave the link as text. If approved, render `handoff.md` to HTML in a new `src/render.ts` with a fixed, escaped subset (headings, lists, code spans, emphasis), keep the `Content-Security-Policy` header, and format the expiry as a readable UTC time.
- Done when: an approved rendering passes a test that a `**bold**` input produces `<strong>` and no raw `**` remains in the HTML.

### 2.5 Changelog, tag, and issue templates
- Add `CHANGELOG.md` with one entry: `0.1.0 — initial public release, commit a8122e9`. Tag `v0.1.0` on that commit. Add `.github/ISSUE_TEMPLATE/bug_report.md` with fields for version, Node version, and steps to reproduce.
- Done when: `git tag --list` shows `v0.1.0` and the template appears under the repository's "New issue" page.

### 2.6 Pin GitHub Actions to full commit SHAs
- `.github/workflows/ci.yml` and `pages.yml` use `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`. Replace each tag with the SHA of the release it names, and keep the tag in a trailing comment.
- Done when: `grep -rn "uses:" .github/workflows` shows only 40-character SHAs with comments.

### 2.7 Confirm private vulnerability reporting is on (STOP: account setting)
- `SECURITY.md` tells reporters to use GitHub's "Report a vulnerability". That option appears only when the repository setting is enabled, which this audit did not verify.
- STOP: the owner enables it in the repository's Settings → Code security, or changes `SECURITY.md` to a contact address.
- Done when: the owner confirms the option is visible on the Security tab.

---

## Phase 3 — Polish

### 3.1 Tidy indentation in the request entry
- `src/app.ts` line 299: `const url = new URL(request.url);` is indented one level too deep. Fix the indent. Done when `npm run typecheck` passes and the line matches its neighbors.

### 3.2 Make the landing page's intent clear to a first visitor
- `src/ui.ts` landing intro: the paragraph reads well; leave the copy. Add one line under the create button only if the owner asks.

---

## Mockup briefs (use these literal values)

Guard, read first: this product has no placeholder surfaces today. Do not remove the unsupported-format notes, the "Read PRIVACY.md" line, the admin-token field, or the revoke control. Every value below is a recommendation derived from the current code, not a decision. Where a value is marked "pending", the owner's brand choice governs; use the value shown only to render the mockup.

### Shared spec (landing, dark; current literal values from `src/ui.ts`)
- Swatches: ground `#111318`; panel `#1b1e27`; field `#101218`; ink `#f4f5f7`; muted `#c3c9d6`; accent `#b9f27c`; accent ink `#17210f`; focus `#ffffff`; warn `#ffd27a`; drop hover fill `#202719`. Border on panel: `#3a4152` (fails 1.4.11; pending the Phase 1.1 value).
- Type: body `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` at 16px / 1.55. H1 `clamp(2.2rem, 7vw, 4.5rem)`, line-height 1, letter-spacing −0.04em. H2 1rem, weight 700. Notes `.88rem`. Eyebrow `.75rem`, weight 700, uppercase, letter-spacing .12em.
- Radii: card 16px; drop zone 12px; inputs and buttons 10px.
- Spacing base: 4px. Card padding 22px (18px under 560px). Section gap 22px. Field label margin 16px top, 7px bottom.
- Elevation: none. Keep flat.
- Focus ring: `outline: 3px solid #ffffff; outline-offset: 2px`.
- Motion: none beyond hover color; `prefers-reduced-motion` disables transitions.
- Signature element: the drop zone, a dashed 1px border in `#7c869e` at 12px radius, 120px minimum height, changing to accent border and `#202719` fill on hover or drag-over.

### Screen 1 — Primary surface, result state (the page after a successful create)
- Frame: 760px max-width column, 16px side gutter, 8vh top padding.
- Components: eyebrow; H1; card (16px radius, 22px padding); the `#result` block containing: a 3px left notice rule in `#ffd27a` when warnings exist; the share URL as a link in `#b9f27c`, wrapping with `overflow-wrap:anywhere`; an expiry line in `#c3c9d6`; a "Copy link" button and a "Revoke link now" button, both secondary (transparent fill, 1px border in the pending boundary color, ink text `#f4f5f7`, 44px tall).
- States: copy success ("Copied"), copy failure ("Copy failed. Select the link and copy it."), revoke in progress (disabled), revoke complete (notice text "The link is off. The workspace content has been deleted.").
- Signature moment: the link is the largest element after the H1, set in accent `#b9f27c` at 1.05rem with a 1px underline offset 3px. Nothing else on the page is that color.

### Screen 2 — Second flow: the share reader (what a collaborator opens)
- Frame: single column, 680px max, 20px gutter. Output is HTML rendered from `handoff.md` (pending the Phase 2.4 decision; the mockup assumes approval).
- Components: a top band stating "Temporary workspace · expires Tue 27 Oct 2026, 21:45 UTC" in `#c3c9d6` at .9rem; H1 "Agent handoff" at 1.6rem; a list of projections as a 2-column table with a 1px border in the pending boundary color and 12px radius; a "Files" table with columns path, kind (Original / Readable), warnings; an "Unsupported format" row uses the `#ffd27a` text color and a text label, not color alone.
- States: loading (text "Loading the handoff…"), expired (410 page: heading "This link has ended", body "The content was deleted when the window ended or the link was revoked."), revoked (same as expired, different sentence).
- Signature moment: each file row shows a small square glyph, filled accent for readable and outlined for original-only, paired with its text label.

### Screen 3 — First run / empty state (the page before anything is selected)
- Frame: the same column as Screen 1. Above the first card, the eyebrow and H1 are unchanged.
- Components: card with three numbered steps (step numerals 22px, accent on `#263119`), "Add what to share" drop zone pair, repository field with placeholder text `https://github.com/owner/repository`, window select with options 1, 6, 12 hours, admin-token field labeled "(only if this deployment asks for one)".
- States: nothing selected (the create button is enabled and returns "Choose files, a folder, or a public GitHub repository first."), a repository and files both selected (message "Choose files or a folder, or a repository, not both in one link."), bad repository address (message "Enter a public GitHub repository address, like https://github.com/owner/repository.").
- Signature moment: the drop zone's hover state fills with `#202719` and a 1px accent border, the only tinted surface on the page.

---

## Open questions for the owner (do not decide these in code)

1. **Real database ID in the public config** (Phase 1.3): keep and document, or restore a placeholder and use a local override?
2. **Field and disclosure boundary color** (Phase 1.1): choose the value; the check is the ratio.
3. **Human reading of the handoff** (Phase 2.4): render HTML for browsers, or keep raw text?
4. **Light theme on the landing page**: the landing forces `color-scheme: dark` and has no light theme, while the site supports both. Is a light theme part of the brand?
5. **Log retention of share paths**: the share token is in the URL path, and Cloudflare request logs may record it. Is redacting paths in the Worker required, or is the owner's own log access an acceptable boundary? Redacting needs a route change, which is a format decision.
6. **Hosted intent**: is the project self-host only permanently? That answer decides whether terms of service and a data processing agreement are needed.
7. **Private vulnerability reporting** (Phase 2.7): enable it, or change the contact.

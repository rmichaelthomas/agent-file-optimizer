# Changelog

## Unreleased

- Code and unlisted text files are read as text: a broad list of code and config extensions, and any other file whose bytes are UTF-8 with no NUL byte. Before, only 12 extensions were, so `.mjs`, `.py`, `.go`, `.sh`, `.toml` and most others came out as original-only.
- XLSX is read as named sheets, one row per line, cells separated by tabs, with shared strings resolved. Before, cells ran together.
- The PDF warning says plainly that many PDFs, including most printed from browsers, cannot be read. README, site, and FAQ now match what was measured.
- `docs/BENCHMARKS.md`: what an agent reads with and without the handoff, measured. No saving on text and code, 76% fewer tokens on one HTML page, Office files made readable.
- MCP endpoint checked with the Python SDK (1.30.0 and 2.3.0) and Claude Code; the official TypeScript SDK check is now a test.
- Uptime check: a GitHub Actions workflow runs `npm run health` against your deployment every 15 minutes once `HEALTHCHECK_URL` is set. A failed run is the alert.
- The rate limiter's accuracy is documented: it is approximate, and a live burst of 700 requests got 31 refusals.

- Discovery: canonical link, Open Graph and Twitter large-image cards with a 1200x630 image, JSON-LD (software and FAQ), `robots.txt`, `sitemap.xml`, `llms.txt`, a favicon, and a visible FAQ on the public site. `npm run site:check` enforces them.
- `npm run og` regenerates the social preview images, including the 1280x640 file for the repository's Social preview setting.
- README rewritten to lead with the problem and a two-minute local start, show real handoff output, compare with the alternatives, and state limits up front.

- Setup: one-click Deploy to Cloudflare button, `npm run deploy`, and a schema that creates itself on first use. No separate migration step.
- A blank `ADMIN_TOKEN` now refuses workspace creation instead of leaving it open.
- A workspace with no files yet serves a handoff that says so, instead of a 404.
- Opening a share link in a browser shows a readable page. Agents and `curl` still receive the Markdown unchanged.
- Rate limiting: 120 requests a minute per caller address, separately for share reads and API calls. Over the limit returns 429.
- Adding a file no longer re-reads the originals of files already parsed.
- The privacy note on the link page is a link. The README has uninstall steps and a note on backups.
- The link-creation page follows the system light or dark setting.
- Per-request logs and traces are off in `wrangler.jsonc`, so a share token is not stored in Workers Logs. The app's own error lines stay on.
- The landing page sends framing, content-type, and referrer protections.
- Internal errors reach the 500 handler and are logged by route class only, never a token.
- Uploads that overlap no longer risk a missing or stale handoff.
- The scheduled cleanup takes at most 200 workspaces per run.
- Input, button, and disclosure borders meet 3:1 contrast.
- `npm run browser-check` drives the landing page in Chrome and runs in CI.
- GitHub Actions are pinned to commit SHAs.

## 0.1.0 — initial public release

Commit `a8122e9`.

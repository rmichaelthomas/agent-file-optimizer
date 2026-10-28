# Changelog

## Unreleased

- Public GitHub import is now a confirmation step. Pasting a repository address lists the files worth sharing, grouped (written for agents, orientation, manifests, tool-specific agent files, docs), with sensible ones ticked. You adjust, then create the link. Only the files you tick are stored, plus an optional names-only list of the repository. Source code, secrets, dependency folders and binaries are never offered, and the server re-checks every chosen path against the same rules. The preview needs the admin token on a deployment that has one. The handoff says files from a repository are its own text, not instructions to the reader.
- Share links serve long projections a part at a time over HTTP (`content.md?part=2`), and the handoff names files that were only partly read, including which archive members a ZIP left out.
- HTML is read as a document, not stripped of tags. A new tokenizer follows the HTML Standard and passes html5lib's tokenizer tests (about 6,000 runs, including all 2,231 named character references) and its encoding tests. The reader keeps headings, lists, tables, links, code, quotations, image descriptions, and math; leaves out hidden content, scripts, and styles; names embedded pages and videos; reads a page's title, language, canonical address, author, and dates when it states them; and says when a page builds itself with scripts. Across ten real pages the reading had about 91% fewer tokens than the markup and found a median 99.9% of pandoc's words.
- EPUB books are read, in the reading order their package sets, with title, authors, language, contents, and chapters. Checked on 27 books (Project Gutenberg, Standard Ebooks, IDPF samples): median 100% of pandoc's words, 26 of 27 above 97%. Encrypted books and picture-only books are refused with a reason.
- PDF: an outline in the file is listed as contents with page numbers, and a file with no title gets a title guessed from the largest text on page 1, marked as a guess. A margin stamp such as arXiv's is not taken for the title.
- MCP: `read_projection` and `read_original` take a `part` and return a long text in parts of about 60,000 characters, because agent clients cut a tool answer off at about 25,000 tokens. The handoff says when `content.md` is long.
- `.xhtml` files are read as HTML. XHTML and EPUB chapters are read as XML: `<p/>` is empty, and a DOCTYPE with an internal subset is skipped, with its entities left unexpanded.
- `DOCUMENT_READING=off` now also covers EPUB.
- Tests: html5lib's tokenizer and encoding tests, and Koncord's reading fixtures, are vendored under `tests/fixtures/` (MIT and the author's own; see `THIRD_PARTY.md`).

- Code and unlisted text files are read as text: a broad list of code and config extensions, and any other file whose bytes are UTF-8 with no NUL byte. Before, only 12 extensions were, so `.mjs`, `.py`, `.go`, `.sh`, `.toml` and most others came out as original-only.
- DOCX, PPTX, XLSX, and PDF now work, not "basic". DOCX keeps headings, lists, tables, links, footnotes, comments, headers and footers, and text boxes. PPTX reads slides in presentation order with titles, bullets, tables, charts, and speaker notes. XLSX reads named sheets with dates, booleans, and shared text. PDF is read from its structure (object streams, fonts and character maps, positioned text). Checked against independent extractors on 70 files: median word recall 100%, word-weighted 99.3%.
- Added `DOCUMENT_READING=off` for Workers plans whose CPU limit is too small to read documents; PDFs, Office files, and ZIPs then stay original-only with a note.
- The PDF parser id is now `native-pdf` (it was `native-pdf-basic`).
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

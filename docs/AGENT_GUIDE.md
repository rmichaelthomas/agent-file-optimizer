# Agent guide

This guide is for coding agents and people working on this repository with agents. It is short on purpose. The README is the human-facing description and should match this file.

## What this project is

A Cloudflare Worker that turns uploaded files into a temporary workspace: originals, readable projections, a manifest, and a bearer share link with a fixed expiry. Storage is R2 for bytes and D1 for metadata. An in-memory mode runs without Cloudflare resources for tests and local use.

It is software to be run by its operator. It is not a hosted service, and do not describe it as one.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs locked dependencies. Use `npm ci` in CI. |
| `npm test` | Runs all Vitest suites. All tests use in-memory adapters and need no network. |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `tests/`. |
| `npm run dev` | `wrangler dev` on local bindings. Apply migrations with `npx wrangler d1 migrations apply agent-file-optimizer --local` first. |
| `npm run deploy:dry` | `wrangler deploy --dry-run`. Builds the bundle and lists bindings. Does not publish. |
| `npm run site:check` | Static checks on `site/index.html`: metadata, no scripts or trackers, attribution, no unsupported claims. |
| `npm run site:preview` | Serves `site/` on `127.0.0.1:8788`. |

Set `WRANGLER_SEND_METRICS=false` when running Wrangler in automation.

## Do not deploy without authorization

Do not run `wrangler deploy` (without `--dry-run`), deploy the site, or create production D1 or R2 resources unless the repository owner has explicitly authorized that deployment in this session.

Current deployments, for reference:

- API Worker `agent-file-optimizer`, with D1 `agent-file-optimizer` and R2 `agent-file-optimizer-files`. Deploy with `npx wrangler deploy`. Its admin token is a Wrangler secret named `ADMIN_TOKEN`.
- The public site is published by GitHub Pages from `site/`, through `.github/workflows/pages.yml` on pushes to `main`. No Cloudflare resource is involved.

`wrangler pages` is not used. In the Wrangler version pinned here, `wrangler pages project create` delegates to Worker deployment and redeploys the API Worker.

## Architecture

| Path | Role |
| --- | --- |
| `src/index.ts` | Worker entry: landing page, HTTP app, scheduled cleanup. |
| `src/app.ts` | HTTP routes, upload and repository import, revoke, share reads, request limits. |
| `src/lifecycle.ts` | Tokens, projection refresh, purge, cleanup (`purgeWorkspace`, `settleWorkspace`, `expireDue`). |
| `src/store.ts` | Workspace and file metadata: `MemoryWorkspaceStore` and `D1WorkspaceStore`. |
| `src/storage.ts` | Blob storage: `MemoryBlobStore` and `R2BlobStore`. |
| `src/parsers/` | Parser routing. `native.ts` is the free default. `types.ts` holds capabilities and the external runner seam. `sandbox-runner.ts` is the isolated runner adapter. |
| `src/projections.ts` | Builds `handoff.md`, `manifest.json`, `tree.txt`, `content.md`, `content.jsonl`. |
| `src/mcp.ts` | Read-only, stateless JSON-RPC endpoint at `/s/<token>/mcp`. |
| `src/repository.ts` | Public GitHub import: allowlisted hosts, redirect limit, archive size cap. |
| `src/safety.ts` | Basic heuristic checks. Not malware scanning. |
| `src/mime.ts` | Content type from extension when the upload declares nothing useful. |
| `src/ui.ts` | The browser interface, rendered as one HTML string. |
| `migrations/` | D1 schema. Apply in order. `0004` adds `purged_at`. |
| `site/` | Public static site for Cloudflare Pages. No build step. |

## API contract

| Method and path | Auth | Notes |
| --- | --- | --- |
| `GET /healthz` | none | `{ ok: true }` |
| `GET /api/capabilities` | none | Parsers, policy, and limits. |
| `POST /api/workspaces` | admin token if `ADMIN_TOKEN` is set | Body `{ intent, windowHours }` with windowHours in 1, 6, 12. Returns `uploadToken` once. |
| `POST /api/workspaces/:id/upload` | upload token | Multipart `file` fields with optional `path` fields. |
| `POST /api/workspaces/:id/import-public-repo` | upload token | Body `{ url }`. Public `github.com` repositories only. |
| `GET /api/workspaces/:id/status` | upload token | Status and counts. No share link. |
| `POST /api/workspaces/:id/revoke` | upload token | Idempotent. Returns `500` with `purged: false` if content deletion is incomplete. |
| `GET /s/:token` | share token (in path) | Returns `handoff.md`. |
| `GET /s/:token/<projection>` | share token | One of the five projections. |
| `GET /s/:token/original/<path>` | share token | Original file. |
| `POST /s/:token/mcp` | share token | Read-only JSON-RPC. Experimental. |

Errors use `{ error, message }`. Status `410` means expired or revoked. Limits: 10 MiB per file; 200 files and 50 MiB per request; 25 MiB per repository archive.

## Invariants to keep

- Access is turned off before content is deleted. Purge is idempotent and tracked with `purged_at`. Any change to deletion must keep both properties and keep the retry path tested.
- Writes that race a revoke or expiry must be followed by a status check. See `writesRacedRevocation` in `src/app.ts`.
- Share tokens and upload tokens are stored only as hashes. Never log them. Never put them in a manifest.
- Originals are always kept, even when no parser applies.
- Native parsing is the default. Any external processing must be explicit, marked in the manifest, and off in the default Worker.
- Repository imports follow redirects only to the GitHub allowlist.
- Paths are normalized by `normalizeRelativePath`. Traversal is refused.
- Do not claim "zero retention", "any file", "malware scanned", or "private repositories supported" in code, docs, or the site.

## Tests

- `tests/api.test.ts`, `tests/archive.test.ts`, `tests/parsers.test.ts`: API, ZIP, and parser behavior.
- `tests/lifecycle.test.ts`: retry after failed purge, expiry cleanup retry, revoke racing an upload, R2 batch deletion, request caps, content types through MCP.
- `tests/mcp.test.ts`: JSON-RPC behavior, expiry, unsafe paths.
- `tests/repository.test.ts`: URL parsing, redirect allowlist, size cap.
- `tests/ui.test.ts`: landing-page content. Browser behavior was checked separately with a real browser (see the PR description for what was run).

When you change behavior, add a test that fails before the change.

## Writing about the project

- Describe what is working, basic, experimental, or not yet, using the README's capability table.
- Name the limits where they matter: PDF and Office extraction is basic; images have no OCR; private repositories are not supported; the MCP endpoint was checked with one client.
- Do not promise token savings. None has been measured.
- Do not add analytics, newsletter forms, testimonials, pricing, or user counts to the site.

## Files that stay local

`work/`, `outputs/`, and `docs/superpowers/` are local working material. They are ignored by git on purpose. They can contain local paths and internal planning. Do not commit them.

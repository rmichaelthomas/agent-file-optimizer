# Changelog

## Unreleased

- Setup: one-click Deploy to Cloudflare button, `npm run deploy`, and a schema that creates itself on first use. No separate migration step.
- A blank `ADMIN_TOKEN` now refuses workspace creation instead of leaving it open.
- A workspace with no files yet serves a handoff that says so, instead of a 404.
- Opening a share link in a browser shows a readable page. Agents and `curl` still receive the Markdown unchanged.
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

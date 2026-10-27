# Privacy

This document describes what Agent File Optimizer stores, how long it keeps it, how it deletes it, and what it cannot control. It describes the code in this repository, not a hosted service. If you run a copy, you are the operator, and the details of your Cloudflare account matter as much as the code.

## What is stored

For each workspace:

- **Metadata** in the D1 database: the workspace ID, creation and expiry times, the window in hours, the intent you chose, status, and a purge timestamp. The two tokens are stored only as SHA-256 hashes. The raw tokens are never stored.
- **File records** in D1: for each file, its relative path, content type, size, SHA-256 hash, upload time, the parser used, warnings, and the basic-check result. Files from a repository import also record the canonical repository URL.
- **Bytes** in R2: each original file, the generated projections (`handoff.md`, `manifest.json`, `tree.txt`, `content.md`, `content.jsonl`), and a cached parse result per file.

The app's own log lines contain the workspace ID or an error name, not file contents or tokens.

## When content is deleted

| Event | What happens |
| --- | --- |
| The window ends | Access returns `410 Gone` immediately, because the app checks expiry on every request. Deletion runs on the next request or within 15 minutes, from the scheduled cleanup. |
| You revoke the link | Access returns `410 Gone` immediately. Revoke deletes the file rows and every R2 object under the workspace prefix before it reports success. |
| A deletion fails partway | Access stays off. The workspace is marked as not yet purged, the response to revoke says so, and the next revoke or the scheduled cleanup retries until the purge completes. |
| An upload or repository import is still writing when a revoke or expiry lands | The write completes, then the app checks the workspace again. If it is no longer ready, the app purges again, so the content written during the race is removed. |

Deletion removes objects and rows through the storage APIs. Whether the provider later erases the underlying bytes is outside the app's control.

Each R2 bulk delete is limited to 1,000 keys. The app sends deletes in batches of that size, so large workspaces are purged completely. This is covered by a test.

## What the app does not promise

- **Secure erasure.** The app removes objects and rows through the normal Cloudflare APIs. It does not promise that the underlying storage media is overwritten or that deleted data cannot be recovered by anyone with provider-level access.
- **Provider retention.** Cloudflare may keep operational data, including request logs, analytics, and backups, under its own policies. Your Worker's observability settings decide what is logged. The share link is part of the request path, and request URLs can appear in logs. Review your account's log and retention settings before you use the app with anything sensitive. The repository does not verify Cloudflare's logging behavior, and that is the operator's responsibility to check.
- **Copies you make.** Anything an agent downloads or saves is outside the app.
- **Copies outside the workspace.** The app does not know about files you copied elsewhere before uploading.

"Zero retention" is a design goal. It is not a guarantee, and this project does not use that phrase to describe its behavior.

## Access

- The share link is a bearer link. Anyone who has it can read the workspace until it expires or is revoked. Share it only with the agent or person you intend.
- The upload token is shown once at creation. It can add files and revoke the workspace. If you lose it, the workspace will end at its expiry.
- If your deployment sets `ADMIN_TOKEN`, only callers who present it can create workspaces. Without it, anyone who can reach your Worker can create workspaces and consume your storage quota. The admin token is never written to workspace metadata or logs.
- Responses are sent with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive Content-Security-Policy for projections and originals, so a shared file is not rendered as an active page in the browser.

## Processing

- Parsing runs inside the Worker, with native parsers. Nothing is sent to another service by default.
- An external parser exists only as an adapter that an operator must inject and explicitly enable. It is off in the default Worker.
- Public repository import contacts GitHub's API and codeload.github.com. It sends no credentials and follows redirects only within GitHub hosts. Private repositories are not supported.

## Scanning

The "basic check" flags a few things: executable or installer extensions, macro markers, and mismatched file headers. It is not malware scanning. A passed check is not a safety verdict.

## Limits that affect privacy

- A workspace can be opened repeatedly until it expires, so the window, not the number of reads, is the real limit.
- The app does not detect secrets, personal data, or sensitive content in files. Do not upload credentials or regulated data unless you have reviewed your deployment's data path.

## Reporting a privacy problem

See [SECURITY.md](SECURITY.md). Please report suspected content leaks privately first.

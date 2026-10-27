# Agent File Optimizer

**Turn a set of files into a temporary, readable workspace, and a link you can share with an agent or a collaborator.**

![The result screen after files were added: a share link, an expiry time, and buttons to copy or revoke it](docs/images/result.png)

You add files, a folder, or a public GitHub repository. The app keeps the originals, adds readable notes where it can, and gives you one link. The link stops working when the window you chose ends (1, 6, or 12 hours), or sooner if you revoke it. Then the stored content is deleted.

It is open source and self-hosted. There is no hosted service to sign up for, and this repository does not run one.

## Why you might use it

- An agent needs to read a folder of mixed files, and you do not want to explain each one or write conversion commands.
- You want to hand something to a collaborator for an afternoon without keeping it around afterwards.
- You want the agent to start from the originals plus a short orientation note, not from whatever it can scrape.

## What an agent receives

Open the link and the first thing it gets is `handoff.md`, a plain-language orientation. The workspace also contains:

| File | What it is |
| --- | --- |
| `handoff.md` | What the workspace is for, when it expires, and what to read first. |
| `manifest.json` | Each file with its hash, the parser used, a confidence level, and any warnings. |
| `tree.txt` | The folder layout. |
| `content.md` | Readable text from the files that could be converted. |
| `content.jsonl` | Structured records for JSON, CSV/TSV, and similar files. |
| `original/<path>` | Every file exactly as you added it. |

## Capabilities

Status key: **Works** means implemented and tested in this repository. **Basic** means it works for simple cases and can lose content or formatting. **Experimental** means it works in the tests we ran but has not been checked broadly. **Not yet** means not implemented.

| Capability | Status | Notes |
| --- | --- | --- |
| Browser upload: drop files, choose files, choose a folder | Works | Folder paths are kept. Checked in a real browser at desktop and phone widths. |
| Retention windows of 1, 6, or 12 hours | Works | Expiry is enforced on every read, and a scheduled cleanup runs every 15 minutes. |
| Revoke a link | Works | The link returns `410` at once. Content deletion is retried if it fails partway. |
| Text, Markdown, code, logs | Works | Preserved, with readable notes. |
| JSON, CSV, TSV | Works | Structured records in `content.jsonl`. |
| HTML | Works | Basic text extraction. |
| ZIP archives | Works | Members are extracted within size and count limits. |
| DOCX, PPTX, XLSX | Basic | Text only. Formatting, images, comments, and some content may be missing. |
| PDF | Basic | Text where the PDF contains text. Scanned pages and complex layouts may be missing. |
| Images and scans | Original only | Kept as originals with a warning. No text recognition is built in. |
| Public GitHub repository import | Works | Only `github.com` public repositories over HTTPS. Redirects are limited to GitHub hosts. 25 MiB archive cap. |
| Private repositories | Not yet | Not supported. |
| Read-only MCP endpoint on the share link | Experimental | Tested with the official MCP TypeScript SDK client (`@modelcontextprotocol/sdk` 1.32.2). Other clients are untested. |
| Malware scanning | Not yet | The "basic check" is a few heuristics, not a malware verdict. |
| External parser (OCR, Office, PDF engines) | Not yet | The adapter seam exists. It is off by default and not configured. |
| Direct-to-storage uploads for large files | Not yet | Each file is capped at 10 MiB, and a request at 200 files and 50 MiB. |
| Hosted instance | Not provided | You run your own copy. See [Self-hosting](#self-hosting). |

Limits are published by the API at `GET /api/capabilities`.

## Try it locally

The project was developed and tested on Node.js 22.

```sh
npm install
npm test
npm run typecheck
npm run dev
```

Open the local address Wrangler prints. Local mode uses in-memory storage, so workspaces disappear when the dev server restarts. That is fine for trying the app, and it is not a deployment.

The same flow works through the HTTP API:

```sh
created=$(curl -sS -X POST http://localhost:8787/api/workspaces \
  -H 'content-type: application/json' \
  -d '{"intent":"agent-understanding","windowHours":6}')

upload_url=$(printf '%s' "$created" | jq -r .uploadUrl)
upload_token=$(printf '%s' "$created" | jq -r .uploadToken)
share_url=$(printf '%s' "$created" | jq -r .shareUrl)

curl -sS -X POST "$upload_url" \
  -H "authorization: Bearer $upload_token" \
  -F 'file=@README.md'

curl -sS "$share_url"                  # handoff.md
curl -sS "$share_url/manifest.json"
```

The upload token is returned only once, when the workspace is created. Keep it if you want to upload more files or revoke the link.

## Self-hosting

### Prerequisites

- A Cloudflare account with Workers, R2, and D1 available.
- Node.js 22 (the version used for development and CI), and the dependencies from `npm install`.
- A decision about who may create workspaces. Without an admin token, anyone who can reach your Worker can create one.

### Steps

1. Create an R2 bucket and a D1 database. You can use the dashboard or Wrangler:

   ```sh
   npx wrangler r2 bucket create agent-file-optimizer-files
   npx wrangler d1 create agent-file-optimizer
   ```

2. Put the D1 `database_id` from the output into `wrangler.jsonc`, replacing `replace-with-your-d1-database-id`. The R2 bucket name there must match the bucket you created.

3. Apply the schema to the remote database:

   ```sh
   npx wrangler d1 migrations apply agent-file-optimizer --remote
   ```

4. Set an admin token. Only people who know it can create workspaces:

   ```sh
   npx wrangler secret put ADMIN_TOKEN
   ```

5. Optionally set `APP_BASE_URL` in `wrangler.jsonc` to your public address, for example when the Worker sits behind a custom domain.

6. Check the bundle, then deploy:

   ```sh
   npm run deploy:dry
   npx wrangler deploy
   ```

   `deploy:dry` builds the Worker and lists its bindings without publishing. It does not prove that your account, bucket, or database is set up correctly.

Until both `DB` and `FILES` are bound, the Worker runs in memory mode. Memory mode loses everything when the isolate restarts, so do not use it for real handoffs.

The scheduled cleanup runs from the `*/15 * * * *` cron in `wrangler.jsonc`. Keep that trigger enabled, or expired workspaces will only be removed when someone next requests them.

Read [PRIVACY.md](PRIVACY.md) before pointing the app at anything sensitive.

## How a share link works

A share link is a bearer link. Anyone who has it can read the workspace until it expires or is revoked. The link is not one-time: an agent can read `handoff.md`, then the manifest, then any file, as many times as it needs within the window.

The upload token and the share link are separate. The upload token can add files and revoke the workspace. The share link can only read. Both are random, and the server stores only their hashes.

## Documentation

- [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md): setup, commands, architecture, API contracts, and rules for agents working on this code.
- [docs/examples/](docs/examples/): a sample `manifest.json` and an MCP exchange.
- [PRIVACY.md](PRIVACY.md): exactly what is stored, when it is deleted, and what remains outside the app's control.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to work on the project.
- [ROADMAP.md](ROADMAP.md): what is planned, and what is deliberately not.
- [THIRD_PARTY.md](THIRD_PARTY.md): dependencies and licenses.

## Project status

The maintainer runs one private deployment on Cloudflare (a Worker, an R2 bucket, and a D1 database), gated by an admin token. It is not offered as a public service. The project's public site is a static page in `site/`, published with GitHub Pages.

This is a small project with a short operating history. Read the limits above before relying on it, and run your own copy if you need it.

## License

Apache License 2.0. See [LICENSE](LICENSE).

Built by [R. Michael Thomas](https://rmichaelthomas.com).

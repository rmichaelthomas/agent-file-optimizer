# Roadmap

This is a short, honest list. It is not a promise of dates. Items move down when they are not needed and up when someone needs them.

## Next

- Run the MCP endpoint against more clients and record the results in the README.
- Deploy a test instance on a Cloudflare account and record what the dry run did not cover: bindings, the cron, and cleanup under real storage.
- Measure the readable projections on real folders before claiming any token saving. Until then, the app does not claim one.

## Later, if they are needed

- Direct-to-storage upload grants for files larger than 10 MiB.
- Private repository access through a local companion that holds the credentials on the user's machine.
- An OCR or document-engine runner, explicitly enabled and priced by the operator.
- Richer Office and PDF extraction.

## Deliberately not planned

- A hosted, multi-tenant service run by the maintainer.
- Accounts, billing, or usage dashboards.
- Claims of malware scanning. A real scanner would be a separate, clearly named integration.

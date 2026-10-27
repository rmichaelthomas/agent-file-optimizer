# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's "Report a vulnerability" option on the repository's Security tab. If that is unavailable, contact the maintainer through the address on [rmichaelthomas.com](https://rmichaelthomas.com).

Please include:

- What you found and where (file and route, if you know them).
- Steps to reproduce, or a small request that shows the behavior.
- The impact you believe it has.

The maintainer will acknowledge a report as soon as practical. This is a small, personal project and does not have a service-level commitment. Fixes will be made on the main branch, and advisories will be published when a fix is available.

Please do not test against deployments you do not own or operate. Please avoid accessing other people's workspaces, and do not publish exploit details before a fix is available.

## Scope

In scope: the Worker code in `src/`, the migrations, the browser interface, and the public site in `site/`.

Out of scope: your Cloudflare account configuration, the content of workspaces you create, and the behavior of third-party services. Findings about the basic file check are welcome as bug reports, but they are not vulnerabilities, because that check is a heuristic and is not described as malware scanning.

## Known limits

These are documented, not hidden. See [PRIVACY.md](PRIVACY.md) and the README's capability table for detail.

- Share links are bearer links.
- Deletion is best-effort with retry. It is not secure erasure.
- Without an admin token, the Worker accepts workspace creation from anyone who can reach it.
- Request paths, including share tokens, may appear in Cloudflare's logs depending on your settings.
- The MCP endpoint is experimental.

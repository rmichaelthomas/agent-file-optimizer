# Roadmap

This is a short, honest list. It is not a promise of dates. Items move down when they are not needed and up when someone needs them.

## Next

- Readable PDFs. The benchmark found that PDFs from a PDF library and from Chrome gave no text, because the reader handles only plain-string text. Support for common font encodings is the most useful extraction work left.
- DOCX tables as rows, not one cell per line.
- Run the MCP endpoint against more clients (Claude Desktop, Cursor, VS Code, and the MCP Inspector were not available) and record the results. Three clients are recorded in `docs/examples/mcp-session.md`.
- Watch the scheduled cleanup on the private deployment over several days and record what it deleted, and whether any retries were needed.
- Measure on real folders from real users, not only this repository's own files. A first benchmark is in `docs/BENCHMARKS.md`: no saving on text and code, a large one on markup-heavy HTML, and Office files made readable. The app does not claim a general saving.

## Later, if they are needed

- Direct-to-storage upload grants for files larger than 10 MiB.
- Private repository access through a local companion that holds the credentials on the user's machine.
- An OCR or document-engine runner, explicitly enabled and priced by the operator.
- Richer Office extraction (tables, comments).

## Deliberately not planned

- A hosted, multi-tenant service run by the maintainer.
- Accounts, billing, or usage dashboards.
- Claims of malware scanning. A real scanner would be a separate, clearly named integration.

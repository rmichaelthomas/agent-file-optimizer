# Roadmap

This is a short, honest list. It is not a promise of dates. Items move down when they are not needed and up when someone needs them.

## Next

- PDFs from more writers. The reader is checked against 59 PDFs from Chrome, macOS, Ghostscript and TeX, and ReportLab; files from Word, LibreOffice, InDesign, and Google Docs have not been tried. Chinese, Japanese, and Korean text with no character map is not read.
- Column-aware reading order for multi-column PDFs, which today come out in the order the PDF draws them.
- OCR for scans, as the optional document runner.
- Notes in place. A web page or book with footnotes keeps its marker where the sentence is and its note at the end; reading would be easier with the note beside the sentence. On one Wikipedia article that is 260 markers and 272 note blocks.
- Run the MCP endpoint against more clients (Claude Desktop, Cursor, VS Code, and the MCP Inspector were not available) and record the results. Three clients are recorded in `docs/examples/mcp-session.md`.
- Watch the scheduled cleanup on the private deployment over several days and record what it deleted, and whether any retries were needed.
- Measure on real folders from real users, not only this repository's own files. A first benchmark is in `docs/BENCHMARKS.md`: no saving on text and code, a large one on markup-heavy HTML, and Office files made readable. The app does not claim a general saving.

## Later, if they are needed

- Direct-to-storage upload grants for files larger than 10 MiB.
- Private repository access through a local companion that holds the credentials on the user's machine.
- An OCR or document-engine runner, explicitly enabled and priced by the operator.
- Richer Office extraction: spreadsheet number formats, charts in Word, and equations.
- Forms (the fields a page asks for) and RSS or Atom feeds, which the HTML reader does not treat specially yet.

## Deliberately not planned

- Dropping repeated paragraphs to save tokens. A page can repeat a sentence on purpose, such as a warning under each of a hundred functions, and removing it would lose that fact without saying so.
- A hosted, multi-tenant service run by the maintainer.
- Accounts, billing, or usage dashboards.
- Claims of malware scanning. A real scanner would be a separate, clearly named integration.

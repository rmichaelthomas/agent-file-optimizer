# Benchmarks: what an agent actually reads

Measured 27 Oct 2026, on the code in this repository, against a corpus built from the repository's own files.

**The short answer.** Agent File Optimizer does not make text smaller, and it does not claim to. On text, Markdown, code, and CSV the readable notes are within a few percent of the original. It saves tokens where the original carries a lot of markup (one HTML page: 76% fewer tokens), and for Office files and PDFs it turns something an agent cannot read at all into readable text. The value is orientation and readability, not compression. A second section below checks that the reading itself is accurate.

## How it was measured

- **Corpus (15 files, 8 formats).** Real text files from this repository (Markdown, TypeScript, an `.mjs` script, JSON, a 270-row CSV, one HTML page), plus generated containers filled with the repository's own prose: a DOCX, an XLSX, a PPTX, a PDF from a PDF library, and a PDF printed from Chrome. The containers are synthetic, so real-world Office and PDF files will behave differently. `scripts/benchmark/make_corpus.py` rebuilds it.
- **Method.** Each file went into its own workspace on a local copy, and `content.md` was read back through the share link. Then all 15 went into one workspace. `scripts/benchmark/measure.py` does this.
- **Tokens.** Counted with `o200k_base`, an OpenAI tokenizer, as a proxy. Claude's tokenizer counts differently, so read token figures as indicative. Percentages between two texts should move together, but they are not exact for Claude.
- **Not measured.** Whether an agent answers better with the handoff. Latency. Real-world Office files and PDFs from Word, LibreOffice, InDesign, or Google Docs. Anything with Claude's own tokenizer.

## Results

"Raw" is the file read as text. "XML inside" is what an agent would face if it simply unzipped an Office file, which is the only way it could read one without a converter.

| File | Raw tokens | XML inside | `content.md` tokens | Change vs raw |
| --- | ---: | ---: | ---: | ---: |
| agent-guide.md | 2,211 | | 2,227 | +0.7% |
| privacy.md | 1,245 | | 1,260 | +1.2% |
| roadmap.md | 215 | | 230 | +7.0% |
| app.ts | 4,554 | | 4,569 | +0.3% |
| deploy.mjs | 966 | | 982 | +1.7% |
| manifest.json | 564 | | 579 | +2.7% |
| package.json | 410 | | 425 | +3.7% |
| commits.csv | 573 | | 658 | +14.8% |
| packages.csv (270 rows) | 11,606 | | 12,143 | +4.6% |
| site.html | 6,339 | | 1,529 | **−75.9%** |
| privacy.docx | not readable | 3,630 | 1,296 | −64.3% vs XML |
| commits.xlsx | not readable | 2,782 | 647 | −76.7% vs XML |
| readme-deck.pptx | not readable | 3,678 | 692 | −81.2% vs XML |
| agent-guide.pdf (PDF library) | not readable | | 2,362 | text of the source guide: 2,211 |
| privacy-chrome.pdf (Chrome) | not readable | | 1,351 | text of the source file: 1,245 |

Across the ten files an agent can read as text, the readable notes total 24,602 tokens against 28,683 raw. Without the one HTML page it is 23,073 against 22,344, which is 3% more. The three Office files total 2,635 tokens of readable text against 10,090 of XML. The two PDFs come out within 9% of the text they were made from.

### What the handoff costs

| Piece | Tokens |
| --- | ---: |
| `handoff.md` (fixed text) | 255 |
| `manifest.json`, one file | about 415 |
| `manifest.json`, all 15 files | 3,502 (about 230 per file) |
| `tree.txt`, 15 files | 205 |
| `content.jsonl` | larger than the source: +0% to +40% for text, so read `content.md` |

An agent that reads `handoff.md` and `content.md` pays 255 tokens of orientation on top of the content. It can skip `manifest.json` until a warning matters.

## What this supports saying, and what it does not

- **Supported:** "On one HTML page, the readable text was 76% fewer tokens than the markup." "Office files, which an agent cannot read directly, become readable text." "On text and code the notes are within a few percent of the original."
- **Not supported:** any general "saves N% of tokens" claim. The corpus is small, one HTML page is not a sample, and the tokenizer is a proxy.

## Is the reading accurate?

Token counts say nothing about whether the text is right, so the reader was also checked against independent extractors: poppler's `pdftotext` for PDFs, and python-docx, python-pptx, and openpyxl for Office files. For each file, recall is the share of the reference's words that appear in our output. Words are lower-case letters and digits.

| Format | Files | Median recall | Word-weighted recall | Files under 90% |
| --- | ---: | ---: | ---: | ---: |
| PDF | 59 | 100% | 99.3% | 3 |
| DOCX | 6 | 100% | 100% | 0 |
| PPTX | 3 | 100% | 100% | 0 |
| XLSX | 2 | 100% | 100% | 0 |

The PDFs are 55 real documents found on a Mac (macOS license texts and Apple app documents written by Quartz, GNU manuals written through Ghostscript and TeX, an Energy Star form), four more from app bundles, plus six written for the test by Chrome, macOS, and ReportLab. Excluding the two Asian-language files below, PDF word-weighted recall is 99.7%. The Office files were written by pandoc, python-docx, python-pptx, openpyxl, XlsxWriter, and macOS's `textutil`.

The three PDFs under 90%:

- **Two license PDFs in Japanese and Korean.** Their fonts have no character map, so the text cannot be decoded without the font vendors' character tables. The reader says so in a warning and keeps the original.
- **One Apple document** where a font maps an "ft" ligature glyph to the digit 1, so "software" comes out "so1ware". poppler drops that glyph instead ("so ware"). Both are wrong; the PDF's own character map is at fault.

What this does not show: files from Microsoft Word, LibreOffice, InDesign, and Google Docs were not available to test, and reading order for multi-column pages was not measured (recall is by word, not by order).

## Problems this benchmark found, and what was done

1. **Most code was treated as original-only.** Only 12 extensions were recognized, so `.mjs`, `.py`, `.go`, `.rs`, `.sh`, `.toml` and most others produced no readable text. Fixed: a broad extension list, and any unlisted file whose bytes are valid UTF-8 with no NUL byte is read as text.
2. **XLSX cells were glued together** ("hashauthordatesubject"). Fixed, then rewritten properly: named sheets, tab-separated cells, shared strings, dates, booleans, and formulas.
3. **PDF extraction found no text in either test PDF.** The first reader handled only plain-string text. It was replaced with a real PDF reader (object streams, page tree, font encodings and character maps, positioned text, form XObjects), which also fixed three bugs the comparison found: byte decoding that altered bytes 0x80 to 0x9F, TeX ligatures stored in a font's own encoding, and word gaps drawn as character spacing.
4. **DOCX, PPTX, and XLSX were read as raw XML with the tags stripped.** They are now read from their structure: headings, lists, tables, slide order, notes, and so on.
5. **Still open:** reading a PDF or Office file takes more CPU than Cloudflare's free Workers plan allows for large files. `DOCUMENT_READING=off` keeps them as originals.

## Rerun it

```sh
npm run dev   # in one terminal
python3 -m venv .bench && .bench/bin/pip install tiktoken python-docx openpyxl python-pptx reportlab
.bench/bin/python scripts/benchmark/make_corpus.py /tmp/afo-corpus
.bench/bin/python scripts/benchmark/measure.py /tmp/afo-corpus /tmp/afo-results.json http://127.0.0.1:8787
```

To rerun the accuracy check on your own files:

```sh
EVAL_IN=/path/to/pdfs-and-office-files EVAL_OUT=/tmp/afo-out npx vitest run tests/extraction-dump.test.ts
.bench/bin/python scripts/benchmark/compare_extraction.py /path/to/pdfs-and-office-files /tmp/afo-out
```

It needs `pdftotext` (poppler) on the path and `pip install python-docx python-pptx openpyxl`.


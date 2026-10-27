# Benchmarks: what an agent actually reads

Measured 27 Oct 2026, on the code in this repository, against a corpus built from the repository's own files.

**The short answer.** Agent File Optimizer does not make text smaller, and it does not claim to. On text, Markdown, code, and CSV the readable notes are within a few percent of the original. It saves tokens where the original carries a lot of markup (one HTML page: 76% fewer tokens), and for Office files it turns something an agent cannot read at all into readable text. The value is orientation and readability, not compression.

## How it was measured

- **Corpus (15 files, 8 formats).** Real text files from this repository (Markdown, TypeScript, an `.mjs` script, JSON, a 270-row CSV, one HTML page), plus generated containers filled with the repository's own prose: a DOCX, an XLSX, a PPTX, a PDF from a PDF library, and a PDF printed from Chrome. The containers are synthetic, so real-world Office and PDF files will behave differently. `scripts/benchmark/make_corpus.py` rebuilds it.
- **Method.** Each file went into its own workspace on a local copy, and `content.md` was read back through the share link. Then all 15 went into one workspace. `scripts/benchmark/measure.py` does this.
- **Tokens.** Counted with `o200k_base`, an OpenAI tokenizer, as a proxy. Claude's tokenizer counts differently, so read token figures as indicative. Percentages between two texts should move together, but they are not exact for Claude.
- **Not measured.** Whether an agent answers better with the handoff. Latency. Real-world Office and PDF files. Anything with Claude's own tokenizer.

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
| privacy.docx | not readable | 3,630 | 1,247 | −65.6% vs XML |
| commits.xlsx | not readable | 2,782 | 603 | −78.3% vs XML |
| readme-deck.pptx | not readable | 3,678 | 651 | −82.3% vs XML |
| agent-guide.pdf (PDF library) | not readable | | 81 | no text extracted |
| privacy-chrome.pdf (Chrome) | not readable | | 82 | no text extracted |

Across the ten files an agent can read as text, the readable notes total 24,602 tokens against 28,683 raw. Without the one HTML page it is 23,073 against 22,344, which is 3% more. The three Office files total 2,501 tokens of readable text against 10,090 of XML.

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

## Problems this benchmark found, and what was done

1. **Most code was treated as original-only.** Only 12 extensions were recognized, so `.mjs`, `.py`, `.go`, `.rs`, `.sh`, `.toml` and most others produced no readable text (`deploy.mjs` gave 46 tokens of nothing). Fixed: a broad extension list, and any unlisted file whose bytes are valid UTF-8 with no NUL byte is read as text.
2. **XLSX cells were glued together** ("hashauthordatesubject"), and a real Excel file's text cells would have appeared as numbers pointing into a table the reader never resolved. Fixed: one section per named sheet, one line per row, cells separated by tabs, shared strings resolved.
3. **PDF extraction is much weaker than "basic" suggested.** Neither a PDF from a PDF library nor one printed from Chrome gave any text. The reader handles only PDFs that store text as plain strings. The README, the site, and the warning message now say so. Better PDF extraction is on the roadmap, not claimed.
4. **Still open:** DOCX tables come out one cell per line, not as rows.

## Rerun it

```sh
npm run dev   # in one terminal
python3 -m venv .bench && .bench/bin/pip install tiktoken python-docx openpyxl python-pptx reportlab
.bench/bin/python scripts/benchmark/make_corpus.py /tmp/afo-corpus
.bench/bin/python scripts/benchmark/measure.py /tmp/afo-corpus /tmp/afo-results.json http://127.0.0.1:8787
```

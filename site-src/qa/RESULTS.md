# QA results

Run on 2026-10-28 against the built `site/`, served by `npm run site:preview` at `http://127.0.0.1:8788/agent-file-optimizer/` and driven with Chrome (headless) through `playwright-cli`. Failures found during the run are listed with what was done about them.

## What was checked, and what was seen

| Check | Result |
| --- | --- |
| Network | The page loaded `favicon.svg` and nothing else (`performance` resource entries). Links go to `github.com`, `rmichaelthomas.com` and Cloudflare's deploy page only; no request is made to them. |
| Console | 0 errors, 0 warnings (Chrome console log). |
| Tab order | The first stop is the skip link, then the brand, the seven navigation links, the two buttons, then the first disclosure and its code block. Every code block that can scroll is reachable by keyboard. |
| Native disclosures | Opening `manifest.json` closed `handoff.md` (the shared `name` attribute); the page needs no script for that. |
| Structure | 1 `h1`, 1 `main`, 1 labelled `nav`, 0 buttons, 0 images; 10 disclosures, 3 open on load. The page tests add: no duplicate ids, every `aria-labelledby` resolves, every table has a caption and column headers. |
| Horizontal overflow | None at 320, 360, 390, 768, 1280 and 1920 px wide (light theme), measured on every element outside code blocks. |
| Narrow screens (390 px) | Hero, ribbon and formats table screenshots reviewed. |
| Forced colors | Hero, the life-of-a-link ribbon, and the "When the window ends" section screenshots reviewed. The window bars, step markers and the last rung of the ladder stay visible. The open and ended panels lose their green and rust top borders and are told apart by their headings only. |
| Dark theme | Hero and "The numbers" screenshots reviewed. |
| Print (Chrome PDF, Letter) | Pages 3 and 4 reviewed: the open and closed files of the sample workspace all print in full, as readable text. The other pages were not read. |
| Contrast | Computed from the colour tokens by `contrast.test.mjs`: every text and surface pair is at least 4.5:1 in both themes, and borders and focus rings at least 3:1. This is the token pairs, not every rendered element. |
| Reduced motion | The page has no animation or transition. Smooth scrolling is applied only when the visitor has not asked for reduced motion. Read from the CSS, not emulated. |
| Scripts off | The page contains no script, so there is nothing to switch off. The disclosures and anchors are native. |

## Defects found in this run

1. The pull quote in "When the window ends" was squeezed to six short lines. Fixed (wider measure, smaller type).
2. The sample `handoff.md` and `content.md` scrolled sideways inside their boxes. Fixed (the code blocks inside the file list wrap).
3. On a phone, the formats table's caption was squeezed to one word per line. Fixed.
4. My first forced-colors and dark-mode screenshots of the later sections did not scroll and showed the hero again, and one dark capture inherited forced colors. I did not count them; I re-took them after resetting the emulation.

## Not run

- Firefox and WebKit. `details name=` (exclusive disclosures) and `::details-content` (print) are newer features; in a browser without them the files still open one by one, and closed files may not print.
- A screen reader.
- Real browser zoom at 200% and 400%. The 320 px check stands in for 400% of a 1280 px window; it is not the same thing.
- Dark theme at phone width, and the print layout beyond the two pages above.
- Whether the published `evidence/BENCHMARKS.md` opens in a browser or downloads. GitHub Pages decides that after deploy.
- The live site. This run is against a local server; the live page should be opened after the merge deploys.

## Screenshots

`desktop-light-top.png`, `desktop-light-numbers.png`, `mobile-390-formats.png`, `forced-colors-ends.png`, `desktop-dark-numbers.png`.

# Extending the site

## Add or change a figure

1. Make sure `docs/BENCHMARKS.md` states the figure and the conditions it holds under. If it does not, change the report first, not the page.
2. Add an entry to `site-src/src/claims.json`: `id`, `title`, `group` (`saves`, `no-saving` or `reads`), `plain.say`, `plain.holdsWhen`, `plain.doesntTell`, `figures` (strings exactly as the report writes them), `sources` (the report path and `needles`, the report's own phrases for the conditions), `evidence`, and `command`.
3. Reference it from a section with `{{claim:<id>}}`.
4. `npm run site:build && npm run site:test`. Fix the page, never the guard.

If the result does not flatter the product, it still goes on the page at the same size as the ones that do.

## Add a section

Create a numbered file such as `12-name.html` in `site-src/src/sections/` as a `<section id="name" class="chapter" aria-labelledby="name-h">` with a `data-ahi` jump-point mark, add the matching `{{include:sections/12-name.html}}` token to `shell.html`, and, if it belongs in the page's navigation, add it to `00-bar.html`. A test fails if a section file is not included.

## Add an instrument

1. Find it in AllHereHTML's `instruments/registry/catalog.json` and read its contract in `behaviors.json` (semantic element, interaction, fallback). Use it only if the content fits it; never bend content to a fixed label.
2. Author the markup to that contract: the semantic element it names, the native interaction it names, and `data-ahi="ahi.<family>.<name>"`, `data-ahi-renderer`, `data-ahi-element`, `data-ahi-version="1"`. The page test fails if the tag and `data-ahi-element` disagree, or if the id is not in the catalog (when AllHereHTML is checked out beside this repository).
3. Style it in `components.css`, with a forced-colors rule if it relies on a colour or a background, and a print rule if it hides content.
4. `node site-src/tools/agent-docs.mjs` to refresh the instrument map.

Do not edit AllHereHTML from here. Propose changes there, on their own branch.

## Add a format row or an FAQ entry

Edit `site-src/src/content/formats.json` or `faq.json`. The visible FAQ and the FAQPage structured data are generated from the same file, so they cannot drift. Keep each row to what `README.md` says is true.

## Things not to do

- Do not edit `site/` by hand.
- Do not add a script, a font host, an analytics tag, or an image from another site. The page's Content-Security-Policy refuses them.
- Do not add a general saving claim, a price, a user count, a testimonial or a waitlist. `scripts/check-site.mjs` refuses several of these, and the brief refuses the rest.
- Do not point "check it" at a private address or a repository file the page does not publish.

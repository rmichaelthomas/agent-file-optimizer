"""Measures the HTML reader on real web pages: tokens in the markup against tokens in the reading.

Usage:
  python3 scripts/benchmark/pages.py fetch DIR            # downloads the pages listed below into DIR
  EVAL_IN=DIR EVAL_OUT=OUT npx vitest run tests/extraction-dump.test.ts
  python3 scripts/benchmark/pages.py measure DIR OUT      # token table
  python3 scripts/benchmark/compare_extraction.py DIR OUT # word recall against pandoc

The pages are fetched live, so they change over time; the numbers in docs/BENCHMARKS.md are from the day they were taken.
Tokens are counted with tiktoken's o200k_base, an OpenAI tokenizer used as a proxy. Needs: pip install tiktoken, and curl.
"""
import os, subprocess, sys

PAGES = {
    "wiki-fugue": "https://en.wikipedia.org/wiki/Fugue",
    "mdn-http": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "govuk": "https://www.gov.uk/browse/driving",
    "hn": "https://news.ycombinator.com/",
    "gutenberg": "https://www.gutenberg.org/ebooks/84",
    "arxiv-abs": "https://arxiv.org/abs/1706.03762",
    "python-docs": "https://docs.python.org/3/library/json.html",
    "bbc": "https://www.bbc.com/news",
    "example": "https://example.com/",
    "recipe": "https://www.bbcgoodfood.com/recipes/classic-lasagne",
}

mode, directory = sys.argv[1], sys.argv[2]
if mode == "fetch":
    os.makedirs(directory, exist_ok=True)
    for name, url in PAGES.items():
        status = subprocess.run(["curl", "-sL", "-m", "30", "-A", "Mozilla/5.0 (compatible; agent-file-optimizer-benchmark)", "-o", f"{directory}/{name}.html", "-w", "%{http_code}", url], capture_output=True, text=True).stdout
        print(name, status)
else:
    import tiktoken
    encoder = tiktoken.get_encoding("o200k_base")
    tokens = lambda text: len(encoder.encode(text, disallowed_special=()))
    out = sys.argv[3]
    print(f'{"page":14}{"markup":>10}{"reading":>10}{"fewer":>8}')
    total_raw = total_read = 0
    for name in sorted(os.listdir(directory)):
        raw = tokens(open(f"{directory}/{name}", encoding="utf-8", errors="replace").read())
        read = tokens(open(f"{out}/{name}.txt", encoding="utf-8").read())
        total_raw, total_read = total_raw + raw, total_read + read
        print(f"{name[:-5]:14}{raw:>10}{read:>10}{100 * (1 - read / raw):>7.0f}%")
    print(f'{"all":14}{total_raw:>10}{total_read:>10}{100 * (1 - total_read / total_raw):>7.0f}%')

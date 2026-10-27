"""Measures what an agent reads with and without Agent File Optimizer.

Usage: python3 scripts/benchmark/measure.py CORPUS_DIR RESULTS.json [BASE_URL]
BASE_URL defaults to http://127.0.0.1:8787 (a local `npm run dev`). Each file goes into its own
workspace, then all files into one. Tokens are counted with tiktoken's o200k_base, an OpenAI tokenizer
used as a proxy: Claude's tokenizer counts differently, so treat token numbers as indicative and the
character counts as exact. Needs: pip install tiktoken
"""
import json, os, subprocess, sys, zipfile
import tiktoken

corpus, results_path = sys.argv[1], sys.argv[2]
base = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8787"
encoder = tiktoken.get_encoding("o200k_base")
tokens = lambda text: len(encoder.encode(text, disallowed_special=()))


def post(url, data=None, headers=None, files=None):
    command = ["curl", "-sS", "-X", "POST", url]
    for key, value in (headers or {}).items(): command += ["-H", f"{key}: {value}"]
    if data: command += ["-d", data]
    for name, path in files or []: command += ["-F", f"file=@{path};filename={name}"]
    return subprocess.check_output(command, text=True)


def workspace(paths):
    created = json.loads(post(base + "/api/workspaces", '{"intent":"agent-understanding","windowHours":1}', {"content-type": "application/json"}))
    post(created["uploadUrl"], None, {"authorization": "Bearer " + created["uploadToken"]}, [(os.path.basename(p), p) for p in paths])
    pieces = {n: subprocess.check_output(["curl", "-sS", f"{created['shareUrl']}/{n}"], text=True) for n in ["handoff.md", "content.md", "content.jsonl", "manifest.json", "tree.txt"]}
    post(f"{base}/api/workspaces/{created['id']}/revoke", None, {"authorization": "Bearer " + created["uploadToken"]})
    return pieces


def raw_text(path):
    try:
        return open(path, "rb").read().decode("utf-8")
    except UnicodeDecodeError:
        return None


def office_xml(path):
    """The XML an agent would face if it simply unzipped an Office file."""
    wanted = ("word/document.xml", "xl/sharedStrings.xml", "xl/worksheets/", "ppt/slides/slide")
    with zipfile.ZipFile(path) as archive:
        return "\n".join(archive.read(n).decode("utf-8", "replace") for n in archive.namelist() if n.startswith(wanted) or n in wanted)


per_file = []
for name in sorted(os.listdir(corpus)):
    path = os.path.join(corpus, name)
    pieces = workspace([path])
    raw = raw_text(path)
    inner = office_xml(path) if name.endswith((".docx", ".xlsx", ".pptx")) else None
    per_file.append(dict(file=name, raw_bytes=os.path.getsize(path), raw_chars=len(raw) if raw is not None else None,
                         raw_tokens=tokens(raw) if raw is not None else None,
                         inner_xml_tokens=tokens(inner) if inner is not None else None,
                         content_md_chars=len(pieces["content.md"]), content_md_tokens=tokens(pieces["content.md"]),
                         jsonl_tokens=tokens(pieces["content.jsonl"]), handoff_tokens=tokens(pieces["handoff.md"]),
                         manifest_tokens=tokens(pieces["manifest.json"])))
everything = workspace([os.path.join(corpus, n) for n in sorted(os.listdir(corpus))])
mixed = {key: tokens(value) for key, value in everything.items()}
json.dump(dict(tokenizer="o200k_base (proxy)", per_file=per_file, mixed=mixed), open(results_path, "w"), indent=1)
print(json.dumps(mixed))

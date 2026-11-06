"""Build a human-written prose corpus from text already on this machine.
Sources: Python stdlib docstrings, package READMEs/metadata, Go docs, Newton's Opticks, GPL preamble.
Output: human.json  (list of {source, text}) chunks of 90-260 words of prose."""
import ast, glob, html, json, os, random, re, subprocess, sys

random.seed(7)
out = []

def prose_paragraphs(text):
    # drop code blocks and markup-heavy lines
    text = re.sub(r"```.*?```", "\n", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    paras = re.split(r"\n\s*\n", text)
    good = []
    for p in paras:
        lines = [l.strip() for l in p.splitlines()]
        if any(l.startswith(("#", "|", "-", "*", ">", "$", "    ", "..", ":", "=", "+", "[")) for l in p.splitlines() if l.strip()):
            continue
        s = " ".join(lines)
        s = re.sub(r"`([^`]*)`", r"\1", s)
        s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
        s = re.sub(r"\s+", " ", s).strip()
        if len(s.split()) < 25:
            continue
        sym = sum(s.count(c) for c in "{}()[]=<>_/\\;")
        if sym / max(1, len(s)) > 0.02:
            continue
        if not re.search(r"[.!?]$", s):
            continue
        good.append(s)
    return good

def chunk(paras, src, lo=90, hi=260):
    buf = []
    for p in paras:
        buf.append(p)
        n = len(" ".join(buf).split())
        if n >= lo:
            words = " ".join(buf)
            if n > hi:  # trim on sentence boundary
                sents = re.split(r"(?<=[.!?])\s+", words)
                acc = []
                for s in sents:
                    if len(" ".join(acc + [s]).split()) > hi: break
                    acc.append(s)
                words = " ".join(acc)
            if len(words.split()) >= lo:
                out.append({"source": src, "text": words})
            buf = []

# 1. Python stdlib docstrings
for f in glob.glob("/usr/lib/python3.11/**/*.py", recursive=True):
    if "/test" in f or "site-packages" in f or "idlelib" in f: continue
    try:
        tree = ast.parse(open(f, encoding="utf-8").read())
    except Exception:
        continue
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)):
            d = ast.get_docstring(node)
            if d and len(d.split()) > 60:
                chunk(prose_paragraphs(d), "python-docstring:" + os.path.basename(f))

# 2. READMEs and package metadata
files = subprocess.run("find / \\( -path /proc -o -path /sys \\) -prune -o \\( -path '*node_modules*' -iname 'readme.md' -size +3k -print \\) -o \\( -path '*dist-info*' -name METADATA -size +4k -print \\)", shell=True, capture_output=True, text=True).stdout.split()
seen = set()
for f in files:
    key = os.path.basename(os.path.dirname(f)).split("-")[0].lower()
    if key in seen: continue
    seen.add(key)
    try:
        chunk(prose_paragraphs(open(f, encoding="utf-8", errors="ignore").read()), "readme:" + key)
    except Exception:
        pass

# 3. Go docs
for f in ["/usr/local/go1.25.1/doc/go_mem.html", "/usr/local/go1.25.1/doc/go_spec.html"]:
    chunk(prose_paragraphs(open(f).read()), "go-doc:" + os.path.basename(f))

# 4. Newton's Opticks (1704) and GPL
newton = open("/usr/local/go1.25.1/src/testdata/Isaac.Newton-Opticks.txt", encoding="utf-8", errors="ignore").read()
chunk(prose_paragraphs(newton)[20:200], "newton-opticks")
gpl = open("/root/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/share/doc/rust/licenses/GPL-3.0-or-later.txt").read()
chunk(prose_paragraphs(gpl), "gpl3")

# dedupe and cap per source so one source can't dominate
by = {}
for o in out:
    by.setdefault(o["source"].split(":")[0], []).append(o)
final = []
caps = {"python-docstring": 70, "readme": 90, "go-doc": 20, "newton-opticks": 20, "gpl3": 8}
for k, v in by.items():
    random.shuffle(v)
    final += v[: caps.get(k, 20)]
json.dump(final, open("human.json", "w"), indent=1)
from collections import Counter
print(len(out), "chunks total;", len(final), "kept", Counter(o["source"].split(":")[0] for o in final))

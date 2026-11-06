"""Build index.html from the source files.

    python3 build.py

Takes src/page_template.html and inserts:
  - the detector engine from src/core.js (everything between // ==CORE== and // ==/CORE==)
  - the Test lab sample passages from src/testlab_samples.txt
The result is a single self-contained index.html that runs entirely in the browser.
Edit the files in src/, never index.html directly.
"""
import json
import pathlib

root = pathlib.Path(__file__).parent
core = (root / "src/core.js").read_text(encoding="utf-8")
core = core.split("// ==CORE==")[1].split("// ==/CORE==")[0]
samples = (root / "src/testlab_samples.txt").read_text(encoding="utf-8").strip()
page = (root / "src/page_template.html").read_text(encoding="utf-8")

assert "/*CORE*/" in page and "/*LABSAMPLES*/" in page, "template placeholders missing"
page = page.replace("/*CORE*/", "// ==CORE==" + core + "// ==/CORE==")
page = page.replace("/*LABSAMPLES*/", json.dumps(samples))
(root / "index.html").write_text(page, encoding="utf-8")
print(f"Wrote index.html ({len(page):,} bytes)")

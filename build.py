"""Build index.html from the source files.

    python3 build.py

Takes src/page_template.html and inserts:
  - the rule engine from src/core.js (everything between // ==CORE== and // ==/CORE==)
  - the statistical feature extractors from src/stats.js and the v10 assessment code from src/ensemble.js
  - the trained classifier weights from src/model.json (made by tests/train.js)
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
stats = (root / "src/stats.js").read_text(encoding="utf-8").split("// ==STATS==")[1].split("// ==/STATS==")[0]
ens = (root / "src/ensemble.js").read_text(encoding="utf-8").split("// ==ENSEMBLE==")[1].split("// ==/ENSEMBLE==")[0]
model_file = root / "src/model.json"
model = model_file.read_text(encoding="utf-8").strip() if model_file.exists() else "null"
assert "/*STATS*/" in page and "/*ENSEMBLE*/" in page and "/*MODEL*/" in page, "template placeholders missing"
page = page.replace("/*CORE*/", "// ==CORE==" + core + "// ==/CORE==")
page = page.replace("/*STATS*/", "// ==STATS==" + stats + "// ==/STATS==")
page = page.replace("/*ENSEMBLE*/", "// ==ENSEMBLE==" + ens + "// ==/ENSEMBLE==")
page = page.replace("/*MODEL*/", model)
page = page.replace("/*LABSAMPLES*/", json.dumps(samples))
(root / "index.html").write_text(page, encoding="utf-8")
print(f"Wrote index.html ({len(page):,} bytes)")

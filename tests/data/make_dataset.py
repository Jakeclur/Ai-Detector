"""Assemble tests/data/dataset.json for tests/eval_corpus.js.

    python3 tests/data/make_dataset.py

Human text: build_human.py collects prose from documentation already on the machine
(Python stdlib docstrings, package READMEs, Go docs, Newton's Opticks, the GPL) and
extra_human.py adds public-domain literature. The machine-collected part is NOT committed
because it comes from other projects' files under their own licences. Paths in
build_human.py are for the Linux environment the detector was built in; adjust them to
whatever prose you have locally.

AI text: ai_samples.py (used for tuning) and ai_holdout.py (kept back for checking).
All AI samples were written by Claude, including "ChatGPT-style" imitations.
"""
import json
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import ai_samples, ai_holdout, extra_human  # noqa: E402

human_json = os.path.join(here, "human.json")
if not os.path.exists(human_json):
    print("Building human corpus with build_human.py ...")
    subprocess.run([sys.executable, os.path.join(here, "build_human.py")], cwd=here, check=False)
human = json.load(open(human_json)) if os.path.exists(human_json) else []
if not human:
    print("Warning: no machine-collected human text found; using only public-domain extras.")
human += [{"source": "pd:" + s, "text": t} for s, t in extra_human.TEXTS]
data = {
    "human": human,
    "ai": [{"source": "ai:" + s, "text": t} for s, t in ai_samples.AI],
    "ai_holdout": [{"source": "aiH:" + s, "text": t} for s, t in ai_holdout.AI_HOLDOUT],
}
json.dump(data, open(os.path.join(here, "dataset.json"), "w"))
print(f"dataset.json: {len(data['human'])} human, {len(data['ai'])} AI, {len(data['ai_holdout'])} AI hold-out")

#!/usr/bin/env bash
# Download part of the Ghostbuster dataset (Verma et al., 2023, https://github.com/vivek3141/ghostbuster-data,
# licensed CC BY 3.0) into tests/data/ghostbuster for tests/eval_ghostbuster.js.
# It holds real human writing (student essays, Reddit stories, Reuters news, English-learner essays)
# and real ChatGPT / Claude output for the same prompts. Not committed to this repo (gitignored).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$here/ghostbuster"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/vivek3141/ghostbuster-data "$tmp/repo"
cd "$tmp/repo"
pats=()
for d in essay/human essay/gpt essay/claude wp/human wp/gpt wp/claude other/ets other/lang8 other/pelic other/toefl91 other/bawe; do
  for i in $(seq 1 300); do pats+=("$d/$i.txt"); done
done
for d in reuter/human reuter/gpt reuter/claude; do
  for i in 1 2 3 4 5 6; do pats+=("$d/*/$i.txt"); done
done
git sparse-checkout set --no-cone "${pats[@]}"
mkdir -p "$dest"
for d in essay wp reuter other; do cp -r "$d" "$dest/"; done
echo "Saved to $dest: $(find "$dest" -name '*.txt' | wc -l) files"

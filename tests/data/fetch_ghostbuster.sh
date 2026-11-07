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
for d in essay/gpt_prompt1 essay/gpt_prompt2 essay/gpt_writing essay/gpt_semantic wp/gpt_prompt1 wp/gpt_prompt2 wp/gpt_writing wp/gpt_semantic other/toefl91; do
  for i in $(seq 1 900); do pats+=("$d/$i.txt"); done
done
# v13: the full 3,000 per folder for the main human / AI folders (BAWE has 4,332)
for d in essay/human essay/gpt essay/claude wp/human wp/gpt wp/claude other/ets other/lang8 other/pelic; do
  for i in $(seq 1 3000); do pats+=("$d/$i.txt"); done
done
for i in $(seq 1 4332); do pats+=("other/bawe/$i.txt"); done
pats+=("other/undetectable/*" "other/gptzero/*")
# paraphrased / perturbed versions of 200 news documents at 5, 20 and 100 edits
pats+=("perturb/labels.txt")
for t in char_basic word_syn word_adj sent_paraph para_paraph sent_adj para_adj; do
  for k in 5 20 100; do for i in $(seq 0 199); do pats+=("perturb/$t/$k/$i.txt"); done; done
done
for d in reuter/gpt_prompt1 reuter/gpt_prompt2 reuter/gpt_writing reuter/gpt_semantic; do
  for i in 1 2 3 4 5 6; do pats+=("$d/*/$i.txt"); done
done
for d in reuter/human reuter/gpt reuter/claude; do
  for i in $(seq 1 60); do pats+=("$d/*/$i.txt"); done
done
printf '%s\n' "${pats[@]}" | git sparse-checkout set --no-cone --stdin
mkdir -p "$dest"
for d in essay wp reuter other perturb; do cp -r "$d" "$dest/"; done
cp LICENSE "$dest/" 2>/dev/null || true
echo "Saved to $dest: $(find "$dest" -name '*.txt' | wc -l) files"

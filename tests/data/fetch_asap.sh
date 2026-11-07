#!/usr/bin/env bash
# Download the ASAP student essays (grades 7-10, 2012) from a public GitHub copy and convert them to
# tests/data/samples/asap.jsonl (gitignored). Check the dataset's terms before using it for anything else.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/training_set_rel3.tsv" "https://media.githubusercontent.com/media/RawEgg6/AI-essay-rater/main/training_set_rel3.tsv"
mkdir -p "$here/samples"
python3 -I "$here/asap_to_jsonl.py" "$tmp/training_set_rel3.tsv" "$here/samples/asap.jsonl"

#!/usr/bin/env bash
# Download independent, test-only datasets into tests/data/external (gitignored, never committed, never trained on).
#   DetectRL (Wu et al., NeurIPS 2024 Datasets & Benchmarks, https://github.com/NLP2CT/DetectRL): human text from
#     arXiv abstracts, XSum news, Reddit WritingPrompts and Yelp reviews, plus GPT-3.5, PaLM-2, Claude-instant and
#     Llama-2-70b text, human-AI mixing at sentence level, paraphrase and perturbation attacks. No licence file in the repo,
#     so it is used for local evaluation only.
#   OUTFOX (Koike et al., AAAI 2024, https://github.com/ryuryukke/OUTFOX, Apache-2.0 code; essays from the Feedback Prize /
#     PERSUADE corpus): US grade 6-12 student essays with ChatGPT, text-davinci-003 and Flan-T5 essays for the same prompts,
#     and DIPPER-paraphrased / OUTFOX-attacked ChatGPT essays. The .pkl files are read with a restricted unpickler that
#     only accepts plain lists and strings (tests/data/outfox_to_jsonl.py).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; dest="$here/external"; mkdir -p "$dest/detectrl" "$dest/outfox"
R=https://raw.githubusercontent.com/NLP2CT/DetectRL/HEAD/Benchmark/Benchmark_Data
for f in Data_Mixing/llm_centered_mixing_test Data_Mixing/multi_llm_mixing_test Data_Mixing/data_mixing_attacks_test \
         Data_Mixing_Human/human_centered_mixing_test Data_Mixing_Human/multi_human_mixing_test Data_Mixing_Human/data_mixing_attacks_test \
         Multi_LLM/multi_llms_ChatGPT_test Multi_LLM/multi_llms_Claude-instant_test Multi_LLM/multi_llms_Google-PaLM_test Multi_LLM/multi_llms_Llama-2-70b_test \
         Direct_Prompt/direct_prompt_test Paraphrase_Attacks/paraphrase_polish_llm_test Paraphrase_Attacks/paraphrase_dipper_llm_test \
         Paraphrase_Attacks/paraphrase_back_translation_llm_test Paraphrase_Attacks_Human/paraphrase_polish_human_test \
         Perturbation_Attacks/perturbation_attacks_llm_test Perturbation_Attacks_Human/perturbation_attacks_human_test \
         Prompt_Attacks/prompt_attacks_llm_test; do
  out="$dest/detectrl/$(echo "$f" | tr / _).json"; [ -s "$out" ] || curl -sSfL --retry 3 "$R/$f.json" -o "$out"
done
O=https://raw.githubusercontent.com/ryuryukke/OUTFOX/HEAD/data
for f in common/test/test_humans common/test/test_problem_statements chatgpt/test/test_lms chatgpt/test/test_outfox_attacks \
         dipper/chatgpt/test_attacks text_davinci_003/test/test_lms flan_t5_xxl/test/test_lms; do
  out="$dest/outfox/$(echo "$f" | tr / _).pkl"; [ -s "$out" ] || curl -sSfL --retry 3 "$O/$f.pkl" -o "$out"
done
if [ "${1:-}" = "--train" ]; then   # DetectRL training files (only used with DRL_TRAIN=1)
  mkdir -p "$dest/detectrl_train"
  for f in multi_llms_ChatGPT_train multi_llms_Claude-instant_train multi_llms_Google-PaLM_train multi_llms_Llama-2-70b_train; do
    out="$dest/detectrl_train/$f.json"; [ -s "$out" ] || curl -sSfL --retry 3 "$R/Multi_LLM/$f.json" -o "$out"
  done
fi
ls -la "$dest"/*/ | head -40

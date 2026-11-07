# Experiment log (v14 onwards)

Every change is measured on the **dev half** of the held-out test data. The **final half** is sealed: it's scored only
by `CONFIRM_FINAL=yes node tests/benchmark.js --final`, which logs each run in `docs/final-runs.md`.
A change is kept only if it doesn't wrongly flag more real human texts in any source group on dev (hard requirement 6),
unless the log gives compelling evidence and says so explicitly.

Notation: "humans flagged" = real human texts given "Likely AI"; "false Mixed" = real human texts labelled "Mixed".
Brackets are 95% intervals.

## E0. Data and evaluation set-up (no model change)

**What changed.**
- **Sealed split.** Every test document is assigned, by a hash of its group, to `dev` or `final` (`tests/lib/datasets.js` `sealSplit`). Before v14 the whole test split was looked at for every decision (v10-v12.3), so both halves have been seen *in aggregate*. Only the new data below is genuinely unseen.
- **Independent Claude set** (`tests/data/claude_indep/`, committed): 240 responses from separate helper sessions running Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 (80 each). They saw only a plain writing request (80 requests: short answers, messages, emails, essays, stories, news, reviews, reflections, student-voice tasks), no detector context. Split by request: about half train, the rest test, then dev/final. Fable 5.1 was unavailable on this account.
- **AI-assisted human text** (`tests/data/samples/ai_polished.jsonl`, gitignored because it contains dataset text): 24 human paragraphs from the Ghostbuster *training* set (student essays, Lang-8, ETS learners), each edited by all three Claude models with "fix the spelling and grammar only" (light) or "improve this paragraph" (heavy). Reported separately, never counted as AI.
- **DetectRL** (Wu et al., NeurIPS 2024; `bash tests/data/fetch_external.sh`, gitignored, test-only): 5,203 human texts (arXiv abstracts, XSum news, WritingPrompts, Yelp) and AI text from GPT-3.5, Claude-instant, PaLM-2 and Llama-2-70b, plus paraphrase, perturbation, prompt-attack and sentence-level mixing sets, and human text polished by an LLM.
- **OUTFOX** (Koike et al., AAAI 2024; test-only): 500 US grade 6-12 student essays with ChatGPT, text-davinci-003 and Flan-T5 essays for the same prompts, plus DIPPER-paraphrased and OUTFOX-attacked ChatGPT essays. Read with a restricted unpickler (`tests/data/outfox_to_jsonl.py`).
- **New benchmark** (`tests/benchmark.js`): v12.3 baseline (frozen in `tests/baselines/v12.3`) vs current, Wilson and Hanley-McNeil intervals, Brier score, balanced calibration table, precision-recall curve, results by length and genre, human false positives by source, mixed-document precision and recall, and attribution.
- **Mixed test sets** (`tests/lib/mixed.js`): "classic" (the v8-v12 test: a same-prompt ChatGPT/Claude paragraph in the middle of a student essay) and "broad" (any genre, random position including first and last, one or two AI paragraphs, same-prompt donor when available), each paired with the same host document without the AI text.
- **Scorer fix.** Mixed was added by the page (`fullAnalysis`), not by `assess()`. The scorer now emulates the page for versions that don't decide Mixed in `assess()`.

**Baseline (v12.3, dev half).**

| | v12.3 |
|---|---|
| Core humans flagged | 1 / 7,664 |
| Core AI caught | 80.7% |
| ROC-AUC / Brier / calibration error | 0.9954 / 0.0168 / 0.0141 |
| Independent Claude caught (40 dev texts) | 40.0% (Opus 54%, Sonnet 43%, Haiku 23%; short requests 10%) |
| DetectRL AI caught (original) | 10.2% (Claude-instant 3.9%, Llama-2 5.6%, PaLM-2 12.5%, GPT-3.5 44%) |
| DetectRL humans flagged | 5 / 2,550 |
| OUTFOX ChatGPT student essays caught | 35.0% (paraphrased 0%) |
| Mixed: classic / broad labelled Mixed | 2.4% / 10.6% |
| Real humans falsely labelled Mixed | 5 / 10,468 |
| AI-polished human text called AI | light 0/12, heavy 0/15, DetectRL polished 6.4% |

**Reading.** The model is strong on the sources it was trained on (Ghostbuster-style essays, stories, news) and weak on
new sources: other model families, other domains, short answers and student-essay ChatGPT. Mixed detection barely works.

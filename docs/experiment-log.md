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

## E1. Trained mixed-authorship model (paragraph level) — kept, then improved in E3

**What.** `paraFeatures` / `mixedScore` in `src/ensemble.js`: 21 features per paragraph (the general model's score on the paragraph, its gap to the other paragraphs' median and maximum, style-vector distance from the rest of the document and how unusual that distance is within the document, function-word delta against the rest, rule-score gap, position, length, quoted text, citations, whole-document score, feature-family contributions). Boosted trees (300 depth-3 trees), balanced Platt calibration, document score = best paragraph. Cut-off = 99.8th percentile of out-of-fold best-paragraph scores on real human training documents. `assess()` now decides Mixed itself; the v8 rule is a fallback when no model is loaded.
**Training data.** Training split only: 2,865 human documents with 3+ paragraphs, each used as is and with 1-2 real AI paragraphs inserted from a training AI document (same prompt when possible), `tests/train_mixed.js`.
**Dev result.** Real humans labelled Mixed 5 → **0** / 10,468; broad mixed set 9.5% → **13.8%**; classic 2.4% → 2.0%; core "Likely AI" unchanged.
**Problem found.** Training cross-validation said 32% at the same cut, dev only 14%: on training documents the general model's paragraph scores are over-confident (it trained on them), and the mixed model learned to expect that.

## E2. Mixed model trained only on documents the general model never saw — rejected

Only 872 hosts qualify (55 essays). Dev broad recall 9.1% (worse than E1's 13.8%). Too little data.

## E4. Recent-Claude specialist retrained with the independent Sonnet and Haiku training texts — rejected

Independent Claude dev 40% → 45% (Opus 54 → 62%, Sonnet 43 → 50%), edited Opus 30 → 50%, but humans flagged rose: core 1 → 3 (ASAP +1, Lang-8 +1), DetectRL humans 5 → 10. The specialist's strict cut-off is set on training humans; on human domains it never saw (arXiv, XSum, Yelp) it fires more. Points to the need for more varied *human* training data.

## E3. Cross-fitted general-model scores for mixed training — rejected (diagnosis was wrong)

Two half-data copies of the general model (`tests/crossfit.js`) to give the mixed model "unseen" paragraph scores. Dev broad recall fell to 2.2% (raw logits) and 0.0% (calibrated logits). A direct check showed the shipped model is **not** over-confident on its training documents (median AI-paragraph logit 3.49 on train vs 3.51 on dev); the half-data copies are simply weaker models (median 0.93-1.10), so their feature distribution doesn't match the shipped model at run time. The E1 train/dev gap comes from elsewhere (different hosts and donors: dev includes OUTFOX hosts and Flan-T5 / davinci / 2023-Claude donors that were rare in training).

## E3b. Three mixed versions per training host, more AI paragraph sources — kept for comparison

2,865 hosts × 3 versions (extra donors from any AI source incl. modern Claude and DetectRL). Dev cut-off sweep (document cut-off on the mixed-model probability):

| Cut-off | Broad recall | Real humans falsely Mixed (of 10,468) |
|---|---|---|
| 0.990 | 32.8% | 9 |
| 0.995 | 22.8% | 3 |
| 0.998 | 9.8% | 0 |

At the shipped training-percentile cut (0.9975) it gave 12.0% / 1 false Mixed. Classic set stays hard (4.9% at 0.995).

## E5. Full general-model retrain with DetectRL training data and the independent Claude training half (G2) — rejected

`DRL_TRAIN=1 V12DATA=1 node tests/train.js`: adds 7,200 DetectRL human texts (arXiv, XSum, WritingPrompts, Yelp) and 4,000 AI texts from GPT-3.5, Claude-instant, PaLM-2, Llama-2 (plain, few-shot, style-mimicking prompts), plus 120 independent Claude training texts.

| Dev | v12.3 | G2 |
|---|---|---|
| Core humans flagged | 1 / 7,664 | **12** (essays 0 → 6, ASAP +3, BAWE +1, Reddit +1) |
| Core recall / AUC | 80.7% / 0.9954 | 83.0% / 0.9938 |
| DetectRL AI caught (Claude-instant / PaLM-2 / Llama-2) | 3.9 / 12.5 / 5.6% | 6.6 / 21.3 / 14.1% |
| DetectRL humans flagged | 5 / 2,550 | 4 |
| Independent Claude (Haiku) | 40% (23%) | 45% (38%) |
| Under-150-word texts caught / humans flagged | 9.9% / 0 | 27.8% / 4 |
| AI-polished heavy edits called AI | 0/15 | 3/15 |

**Why the false flags.** The AI cut-off is a percentile of *all* training humans. 7,200 easy DetectRL humans pull that percentile down, loosening the cut for harder groups (student essays). Next: E6.

## E5b. Bug fixed: tiny feature spreads rounded to zero

`toJSON` stored standard deviations with `toFixed(5)`; a near-constant feature (`style:para_n` in the paragraph model) became 0 and every score became NaN. Now stored with 6 significant digits and a 1e-4 floor. The shipped general model was not affected (no zero spreads).

## E6. G2 with per-source cut-offs (G3, `CUT_BY_SOURCE=1`) — rejected; general model stays v12.3

Same data and weights as G2; the AI cut-off is the strictest of every human source's own 99.9th percentile (sources with 200+ texts), also for the specialists.

| Dev | v12.3 | G2 | G3 |
|---|---|---|---|
| Core humans flagged | 1 / 7,664 | 12 | **0** |
| DetectRL humans flagged | 5 / 2,550 | 4 | **0** |
| Core recall | 80.7% | 83.0% | 72.0% |
| Core ROC-AUC (cut-off independent) | **0.9954** | 0.9938 | 0.9940 |
| OUTFOX ChatGPT essays (never trained on) | 35.0% | 36.2% | 7.5% |
| Independent Claude (40 texts) | 40% | 45% | 30% |

**Decision.** G2/G3 rank core test texts *worse* than v12.3 (lower AUC), so at the same false-flag level they catch less. Their gains were on DetectRL (now in-distribution) and a small, statistically insignificant gain on 40 independent Claude texts; on OUTFOX, which neither saw, there was no real gain. The v12.3 general model is kept. `CUT_BY_SOURCE` and `DRL_TRAIN` stay available for future data.

## Perplexity / neural features — not added (reasons)

- A real token-level perplexity feature needs a language model in the browser (for example GPT-2 small, about 120-500 MB of weights). Model hosting (Hugging Face) is blocked in this environment, so such a model could not be downloaded or tested here, and hard requirement 5 forbids adding one untested.
- Cheap "perplexity" proxies (how common each word is) are vocabulary-richness measures in disguise: they score plain writing, including English learners', as AI-like. Hard requirement 4 forbids that.
- Burstiness is already covered (sentence-length spread, skew, extremes, paragraph rhythm in `stats.js`).

## E8. Recent-Claude specialist with DetectRL humans, independent Sonnet/Haiku and per-source cut-off — rejected

The per-source rule pushed the specialist's cut-off to 1.0 (one human source has scores at 1.0), so it never fires: independent Claude 40% → 27.5%, project Opus texts 42% → 2%. Diagnostic value: with the specialist off, the single core false flag and 2 of the 5 DetectRL false flags disappear, so the specialist carries both most of the recent-Claude detection and part of the false-flag risk.

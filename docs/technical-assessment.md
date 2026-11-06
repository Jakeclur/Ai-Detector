# Technical assessment (v9 → v10)

Written before the v10 rebuild, from measurements on the v9 engine. The results section at the end was added after v10 was built and benchmarked.

## 1. How v9 works

- **Pipeline:** `cleanText` → `features` (~27 hand-written clues: AI word and phrase lists, "not X, it's Y", trailing -ing clauses, transitions, summary closers, formatting, sentence rhythm, human slips, Opus 5.5 answer shape, citations…) → one logistic formula with hand-set weights (partly re-fitted in v5 and v9) → 0–100 score → bands (human < 35 ≤ inconclusive < 55 ≤ AI) → extras: Claude-vs-ChatGPT attribution, edited-AI check, Mixed paragraph check, cautions.
- **Data:** the Ghostbuster dataset (real human and 2023 ChatGPT/Claude text), 40 real Claude Opus 5.5 answers written in this project, and the repo's older Claude-written samples.
- **Testing:** per-group flag rates at one cut-off. There was no threshold-free metric (ROC-AUC), no calibration check, no leakage control, and paraphrased or perturbed text wasn't tested.

## 2. Measured weaknesses

ROC-AUC of the v9 score (1.0 = AI always ranked above human, 0.5 = coin toss):

| AI texts vs human texts (same prompts) | AUC | Reading |
|---|---|---|
| ChatGPT essays vs student essays | 0.987 | Signal is there; the cut-off is the issue |
| ChatGPT stories vs Reddit stories | 0.981 | Same |
| ChatGPT news vs Reuters | 0.960 | Same |
| Claude (2023) essays vs student essays | 0.920 | Weaker |
| Claude (2023) news vs Reuters | 0.759 | Barely any signal |
| Claude (2023) stories vs Reddit stories | 0.713 | Barely any signal |
| Humaniser-tool news vs Reuters | 0.349 | Worse than chance |

**Why Claude is missed.** Almost every clue describes ChatGPT habits (stock phrases, "Moreover", summary closers, bold labels). Claude's stories contain almost none of them. On average, the only clues that fire on Claude stories are the trailing -ing clause (+0.24) and evenness (+0.13), against −0.50 for sentence rhythm. The engine has no way to see the things that do differ: function-word profile, sentence-length distribution, punctuation habits and paragraph shape.

**Why humanised text gets through.** Humaniser tools remove commas, merge and split sentences, and swap words. That produces very long and very short sentences (the "extreme" clue alone averages −1.13 on humaniser text) and other things the engine was told mean "human slip". Hand-set rules can't separate tool-made noise from human messiness. Only a model trained on examples of both can.

**Why polished student essays get flagged.** Every academic phrase ("plays a crucial role", "serves as", "Moreover", "In conclusion") adds to the score on its own, and nothing compares the essay with *other human essays*. Student essays are full of these phrases, so the top human false positives are all essays.

**Other issues:**
- One cut-off for every genre.
- Confidence came only from length.
- No model-disagreement or out-of-distribution signal.
- The train/test split leaked: Reuters journalists reuse paragraphs across articles, the learner corpus has exact duplicates, and 610 paraphrased test documents are edits of training documents.

**Speed** is not a problem: a 23,000-word document takes 0.17 s in Node.

## 3. Design of v10

1. **Keep the explainable rule engine** as one signal family. It gives the clue bars and highlights, and it's strong on ChatGPT.
2. **Add new feature extractors (`src/stats.js`):**
   - sentence-length distribution: mean, spread, skew, short/long shares, lag-1 autocorrelation (burstiness)
   - paragraph shape
   - punctuation profile
   - pronoun profile
   - function-word profile (about 300 common words and punctuation marks; topic is balanced because human and AI texts answer the same prompts)
   - structural repetition: sentence templates, paragraph openings, discourse-marker openers
   - semantic redundancy: content-word overlap between consecutive sentences, similarity between introduction and conclusion, repeated phrases
3. **A trained, calibrated classifier (`src/model.json`):**
   - L2-regularised logistic regression over all features
   - bootstrap ensemble of 7 members; their disagreement is the uncertainty
   - Platt calibration on out-of-fold predictions
   - genre-aware cut-offs chosen from out-of-fold human scores, so each genre's false-positive rate stays low
4. **Fairness constraints inside the training:**
   - contractions, slang and slips can only ever push towards human
   - vocabulary richness and word length are shown as observations but not scored (owner's hard rule)
   - humans weighted more heavily than AI in the loss
5. **Outputs:**
   - an AI likelihood estimate (calibrated probability)
   - classification (likely human / inconclusive / likely AI)
   - confidence (low / medium)
   - evidence quality (limited / moderate / good, from length and how many signal families agree)
   - detected genre
   - an out-of-distribution warning
   - per-paragraph likelihoods
6. **Benchmark (`tests/benchmark.js`):**
   - group-based splits with a near-duplicate leakage check
   - accuracy, precision, recall, F1, FPR, FNR, ROC-AUC, PR-AUC and calibration error
   - reported per genre, model family and editing condition
   - v9 and v10 side by side, written to `docs/benchmark.html`
7. **Import system:** `tests/data/samples/*.jsonl` takes new labelled samples (any model, genre or editing condition) without code changes.

## 4. Limits known before starting

- No API keys for GPT, Gemini, DeepSeek or Llama are available in the build environment, so no samples from those models could be generated. The import system is the integration point.
- Contemporary Claude coverage is the 40 Opus 5.5 answers (+15 simulated edits) written in this project.
- Real perplexity needs a neural language model. Running and testing one in the page isn't possible here (no model download from Hugging Face), so v10 uses statistical features instead.
- Most AI training text is from 2023 models.

## 5. Results (added after building v10)

Held-out test split: 2,339 human and 6,413 AI texts; 610 near-copies of training documents skipped. Full tables are in `docs/benchmark.html`.

| Metric | v9 | v10 |
|---|---|---|
| Recall (AI caught) | 53.3% | 82.0% |
| False-positive rate | 0.38% (9) | 0.13% (3) |
| ROC-AUC | 0.907 | 0.993 |
| PR-AUC | 0.969 | 0.998 |
| F1 | 0.695 | 0.901 |
| Calibration error | 0.152 | 0.012 |

**What worked:**
- **The trained model.** Function-word, sentence-length and punctuation profiles separate 2023 Claude from humans (AUC 0.72 → 0.97).
- **Training on humaniser examples.** Humaniser text is now ranked almost perfectly (AUC 0.34 → 0.995).
- **Genre-aware cut-offs.** Student-essay false positives dropped from 9 to 1.

**What was found and fixed during development:**
- Unshrunk short texts were overconfident.
- The catch-all genre had a cut-off that was too loose.
- Casual human Q&A text was missing from training.
- Joined long documents triggered the Claude specialist.
- Poems and lists were being scored as if they were prose.

**What didn't reach the goal:**
- **Contemporary Claude:** only 29% caught, from 46 training samples.
- **Humaniser text:** good ranking, but only 21% flagged at people-protecting cut-offs.
- **Edited Opus text:** never flagged; 6 of 15 labelled "possibly edited AI".
- **Mixed essays:** about 3% spotted.

These need more and better modern data, especially real outputs from current models and real human-edited AI text. The import folder is ready for it.

## 6. v11 follow-up

**Changes:**
- Gradient-boosted trees blended with the logistic ensemble.
- A trained attribution model (Claude vs ChatGPT).
- A humaniser specialist.
- A minimum-support rule for specialists.
- "Likely human" below 50.
- Version hints from the recent-Claude model.
- 40 more Opus 5.5 samples.

**Results:**
- Held-out humans flagged went 3 → 2, and recall went 82.0% → 83.3%.
- On the larger Opus 5.5 test set (39 texts): 36% detected and 40% of edited Opus.
- Attribution, when a model is named, is right 88–99% of the time (old clue-based attribution: 2–28%).

**Lessons:**
- Choosing a cut-off percentile from held-out false-positive counts is unreliable. A 99.3rd-percentile cut-off flagged 1 human in one run and 17 after retraining. Cut-offs are now set only from the intended percentile.
- Most remaining recent-Claude misses get 90–99 from the main model, but fall in the "other" genre, whose cut-off is held up by three ordinary human texts. Better genre recognition, or more modern human and AI data, is the way forward. Loosening the cut-off would flag real people.

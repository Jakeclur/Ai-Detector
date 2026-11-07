# CLAUDE.md: working context for this repo

This file gives a Claude Code session the full context of how this project was built. It began as a claude.ai conversation (Nov 2026) and was moved here. Read `README.md` for the user-facing description, clue tables, results and sources. This file covers what a developer needs: requirements, decisions, current state and next steps.

## The owner
- A Year 10 student in Brisbane, QLD (Australian spelling, e.g. "realise", "colour").
- Wants plain-English explanations, complete working files (not snippets), and honest limits.
- Built this with Claude over several rounds; the repo is **public**.

## Hard requirements (from the owner, keep these)
1. **Fully in-browser.** No server, no network calls with the user's text, no tracking. The only external load is JSZip from cdnjs (for .docx upload). The page also runs as a claude.ai artifact, where scripts may only load from cdnjs/jsdelivr/unpkg and `fetch` to other hosts is blocked.
2. **Keep:** the per-clue bars, highlights in the text, the section-by-section scan, the Compare tab and the Test lab.
3. **Never claim certainty.** A high score = "look closer", never proof. Confidence labels are only "low" or "medium". Keep the warnings.
4. **Fairness:** don't score vocabulary richness or word length. Don't treat contractions or casual style as AI signs. Show cautions for formal, plain, list-heavy, short and casual-but-tidy text.
5. **Don't add a neural model unless it can actually be tested working.** Still no neural model. v10 adds a *trained linear classifier* (logistic regression, weights in `src/model.json`), which was trained and validated on held-out data in the build environment, as the owner's v10 brief asked.
6. **Never accept a tuning change that wrongly flags more human text.** False positives on real people (especially teens and non-native writers) matter more than catching more AI.
7. Detect any AI model, but be especially good at Claude and ChatGPT, and say which one a text looks more like (Claude-leaning / ChatGPT-leaning / other or can't tell).

## How to build and test
- **Edit `src/`, never `index.html`.** Run `python3 build.py` to regenerate `index.html` (it inserts `src/core.js` between the `// ==CORE==` markers and `src/testlab_samples.txt` as a JSON string).
- `node tests/lab.js [file] [cutoff]` runs Test lab-format files (`---`-separated, label on the first line: Human/Claude/ChatGPT/AI).
- `bash tests/data/fetch_ghostbuster.sh` then `node tests/eval_ghostbuster.js tune|holdout|all` scores **real** human text (student essays, Reddit stories, Reuters, English-learner essays) and **real** ChatGPT/Claude 2023 output (Ghostbuster dataset, CC BY 3.0, gitignored). Tune on `tune`, check `holdout` once.
- `python3 tests/data/make_dataset.py && node tests/eval_corpus.js` scores the larger corpus. The machine-collected human part (`human.json`, `dataset.json`) is gitignored because it's other projects' text under their licences; `build_human.py` has Linux paths from the original environment and may need adjusting.
- No npm or pip packages are required.
- For a visual check, open `index.html` in a browser and click each sample button, the Compare example and "Load 20 sample passages" in the Test lab. There should be no console errors.

## Architecture v10 (read this first)
- **Pipeline:** `ensemble.js: assess(raw)` → `cleanText` → `core.analyze` (rule clues, v9 habit score kept as `rulesScore`) + `stats.styleFeatures` (statistical / structural / semantic features) + `guessGenre` → `modelScore` (trained ensemble in `DETECTOR_MODEL` = `src/model.json`) → genre-aware cut-offs → band `human | inconclusive | ai` (+ `edited`, `mixed` from the old checks) → `likelihood` (calibrated %, also written to `score`), `confidence` (low/medium), `evidence` (limited/moderate/good), `uncertainty` reasons, `ood`.
- **Model (v12):** 50/50 blend of logistic regression and gradient-boosted trees (`tests/lib/gbdt.js`: 250 depth-3 trees, monotone constraints from the same fairness signs) over [27 rule clues | 33 style features | ~300 common-token frequencies | 512 hashed character 3-grams], standardised; 7 bootstrap logistic members (spread → `pLow/pHigh`, confidence); Platt calibration with balanced classes on group-5-fold out-of-fold scores; length shrink of the logit (min 0.3 at 40 words, full at 300); cut-offs: AI ≥ 99.9th percentile of OOF human scores (99.95th per genre, never below the global), "likely human" ≤ max(0.5, 95th percentile). Sign constraints: rule clues keep direction, apostrophe/slang tokens ≤ 0. Human weight 2, Opus weight 8.
- **Specialists** (in `model.json.specialists`): `claude-modern` (Opus 5.5 vs humans, cut at the 99.8th percentile) and `humaniser` (undetectable.ai text vs humans, 99.9th). A specialist only fires if the general p ≥ `minGeneral` (0.05), and for `claude-modern` on texts under 150 words (`minWords`) only if the general p ≥ 0.5 (`shortMinGeneral`, v12.2). Fires → band `ai`. Disabled for out-of-distribution text unless the general p ≥ 0.995.
- **Attribution model** (`model.json.attribution`, v11): Claude (1) vs ChatGPT (0), logistic + GBDT blend trained on AI texts only. Applied in `assess` when the band isn't `human` (and only to the stand-out paragraph for Mixed); p ≥ 0.65 → claude, ≤ 0.35 → chatgpt. Rule-based `attribute()` evidence is kept. `suspect()` version hint: Claude + recent-Claude specialist p ≥ 0.5 → "Claude Opus 5.5", otherwise older/unclear.
- **Long texts** (> 1,500 words): `chunkedScore` scores ~600-word chunks and combines them (a single long document drifted out of distribution and once triggered the specialist on joined human essays).
- **OOD:** ≥ 3 standardised features outside the training range by 25%, poem/list layouts (`layoutOdd`), or non-English → logit × 0.25 and never "likely AI" unless p ≥ 0.995 or a hard giveaway.
- **Rebuild model:** see v12.3 below (the shipped model = v12.2 general model + specialist-only retrain). `node tests/train.js` (about 13 min) → `python3 build.py` → `node tests/benchmark.js` (about 1 min; writes `docs/benchmark.html/json`). `tests/lib/datasets.js` loads all data with group splits and `markLeaks` (near-duplicate check). Import new samples via `tests/data/samples/*.jsonl`.
- **`suspect()` and the page are band-based** since v10 (not score ≥ 55). The Test lab slider's far-left value means "auto" (the detector's own cut-offs).

## Architecture (src/core.js, the rule engine)
- `cleanText(raw)` → `{text, notes}`: strips zero-width and hidden characters, normalises odd spaces, converts full-width characters, folds Cyrillic/Greek look-alikes **only inside words that also contain Latin letters**, and straightens quotes. The page shows a notice from `notes`.
- `features(text)` → rates for ~25 clues plus `counts` (for UI text) and `hits` (highlight ranges: `{start, end, type, label}` with types `hard | word | phrase | struct | trans`).
- `MODEL` = `{bias, w, cap}`: logistic model `z = bias + Σ w·min(f, cap)`. Current bias **-2.1** (v9). v9 weights = constrained logistic fit (humans 3×, signs kept, L2 towards v8) on the bigger Ghostbuster tune split (files ≤150 and 301–600) + repo corpus + lab + Opus tune, then `extreme`/`cv` pinned to v8 (the fit weakened them and flagged Reddit stories) and `vocab` set to 0.8 (fit wanted 1.19, which flagged a university essay). New `cite` feature (in-text citations; −0.95). `vocab` now ×0.4 when only one distinct AI word appears.
- `analyze(text, {noShrink})` → `score` (0–100, shrunk towards 50 for short texts: confidence from 40→300 words), `band` (`human` <35, `inconclusive` 35–54, `ai` ≥55; any hard giveaway with score ≥45 → `ai`), `contrib`, `hits`, `counts`.
- `attribute(text, r)` → `{claude, gpt, lean, confidence, ev}` from `CLAUDE_FP` / `GPT_FP` regex lists plus formatting rules (bold labels, headers, emoji → GPT; plain bullets without bold, spaced em dash, short even sentences → Claude). `lean` needs total ≥2 and margin ≥1.5. Confidence is "medium" only if margin ≥4 and total ≥5. It's only shown when score ≥45.
- `suspect(text, r, attr)` → `{short, label, detail, version, confidence}`: the "Suspected AI" line shown on every result. "No AI suspected" below 35 (unless mixed), otherwise a model from `attribute`'s lean plus a version hint: Claude with em dashes ≥3/1,000 words or "genuinely" → older Claude, else Claude Opus 5.5; ChatGPT with "may provide"/"not necessarily" → GPT-5/6 era, with "delve"/"tapestry" → GPT-4 style, else "ChatGPT or a model like it".
- **Opus 5.5 answer shape** (`shape` in `features`): 5 habits (label-style paragraphs, colon + plain list, one-sentence opening paragraph with 3+ more, "that's why", "the good news is"/"depends on"). `shape` = 0 for 0–1 habits, 0.3 for 2, N−1 for 3+; weight 1.5. Also +N to Claude in `attribute`. Measured on `tests/data/opus55/tune.txt` vs 2,281 human texts (3+ never in humans).
- **Edited-AI check** (`edited` in `counts`, 0/1/2, plus `edHumanEv` / `edSkelEv`): casual touches (casual words, dropped apostrophes, personal story) vs leftover AI skeleton (enumerated causes/stages, "that's why", good-side/bad-side or decision-rule framing, textbook definition opener, shape habit, AI words/phrases). Skipped for narratives (3+ "I/we/he/she was/had/said…"). Level 2 = 2+ of each → `analyze` sets band `edited` and score max(score, 45); `rawScore` keeps the original. Level 1 = a note only. Never pushes to ≥55 (hard requirement 6). `suspect` returns "Possibly AI that a person has edited".
- `paraSplit(text)`: blank-line paragraphs, or single lines when there are no blank lines (used by the shape clue; the evenness clue still uses blank-line paragraphs only, because switching it flagged one more human).
- `segments(text)`: paragraph sections (or ~110-word sentence runs), each scored with `analyze`.
- `mixedCheck(text, r)` (v8): band `mixed` when one paragraph (via `paraSplit`, ≥40 words, not the last) scores ≥72 alone (70 in v8) and ≥40 above the median of the others (`MIXED_RULE`), and the band isn't `ai`. The UI shades that paragraph. Replaced the old window rule, which labelled 76/2,056 real humans (12% of student essays) "Mixed"; new rule 6/2,262 humans, 24/193 real essays with a pasted real ChatGPT/Claude paragraph (old 49).
- `slidingWindow(text)`: ~90-word half-overlapping windows scored with `noShrink`. Kept for tests; the page no longer uses it (single windows were too jumpy).
- `cautions(r)`: fairness notes.
- `compareStyles(known, unknown)`: Burrows' Delta over ~70 function words (means and SDs in `FW_STATS`, measured on the human corpus) plus plain-English style differences. Level: similar / somewhat different / very different.
- `englishCoverage(text)`: share of common English function words. Under 20 → "doesn't look like English".

## Research findings used (2026), with numbers
- **Pangram, Opus 5.5 vs Opus 5** (same 1,000 Arena prompts, *no human baseline*): "genuinely" −83%, "matters enormously" −82%, "the honest answer" → 0; "in short" ×11 (9→100 uses), "for example" ×5.3, "for a long moment" ×2.2, "paused" ×3.9, "stared" ×2.8; also "said quietly", "felt something". Summary markers +942%, numbered items +111%, bullets +85%, caveat markers +23%, negations −28%. Mean sentence 14.5→12.5 words, length spread (CV) 0.534→0.475. Stories lean towards hope, family and resilience. Pangram 4 detected 99.7% of Opus 5.5 outputs.
- **Graphite (Sep 2026), Opus 5.5 vs pre-ChatGPT human articles:** "dependable" 23×, "steady" 11×, "thoughtful" 9×, "meaningful" 8×, "Looking ahead the" 40×, "adds another layer" 27×, "what comes next" 24×, "is more than a _ it" 98×, "rather than simply" 32×, "This matters" 116×, "Why _ matters" 92×. Em dashes: Opus 5 2.92 → Opus 5.5 0.015 per 1,000 words (Arize: 12.9 → 2 in 57,000 words). GPT-6 Astra uses "may provide" 18×, "not necessarily" 17× and "does not establish" 275× as often as Opus 5.5.
- **Arena:** colons 6.10 → 1.64 per 1,000 words; sentence length 12.14 → 10.03 (Opus 5 → 5.5).
- **Idiosyncrasies in LLMs (Sun et al., ICML 2025):** 97.1% five-way accuracy with a fine-tuned embedding model. Word choice is the main signal (shuffling words barely hurts it). ChatGPT: "certainly", "such as", "overall"; opens with "Certainly"/"Below is"; bolds list points and titles answers with headers. Claude: "here", "according to", "based on"; fewer bolds and headers, plain lists, more concise. Models trained on ChatGPT output become ChatGPT-like, which is why unknown models are said to look ChatGPT-leaning.
- **Originality.ai:** blog "AI word" lists are unreliable ("delve" rare in 10M words), so only measured words are used.
- **Will Keleher:** Sonnet prefers spaced em dashes " — ", GPT-5 unspaced "word—word"; newer models vary. So dashes are weak attribution hints only.
- **Economist study:** ChatGPT uses fewer em dashes than human writers, while GPT-5 rewrites (Originality.ai) used them in 67% of articles. Conflicting evidence → em dash weight is tiny.
- **Liang et al. 2023:** 61% of non-native TOEFL essays wrongly flagged by commercial detectors → the fairness rules above.

### Owner's hypotheses (checked)
- Em dash claim (Opus 5 ~15/1,000, Opus 5.5 ~0.8): direction right, but Opus 5 was ~3–13 and Opus 5.5 ~0.02–0.04 depending on the study.
- "Rely on structure over famous words": partly. Measured words are strong; famous *unmeasured* words aren't. Both are now used.

## Current results (v5)
- **Ghostbuster real data, cut-off 55** (2,056 human / 1,800 AI): humans flagged **10 (0.5%)** (v4: 19). Student essays 6/299, English learners 4/1,157, stories 0/300, news 0/300. AI caught **25.0%** (v4: 23.2%): ChatGPT essays 81%, stories 35%, news 7%; Claude essays 23%, stories 1%, news 3%. Hold-out half: humans 6→3 of 1,007, AI 22.4%→24.0%.
- Attribution on real 2023 Claude essays: never "Claude", sometimes "ChatGPT" (Claude clues are 2026-era).
- Own corpus: 216 human passages 0 flagged (max 45, 4 inconclusive). 53 Claude-written AI passages: 39.6% (v4 47.2%; losses are stories/teen-style that relied on the hopeful-ending and too-clean clues, which were also what flagged real learners).
- Built-in 20 samples: AI 8/11, humans 0/9, model 8 right, 0 wrong, 3 can't tell.
- Mixed essay: overall 22 → "Mixed"; AI section 68; window max 71.
- A trained common-word logistic model (400 words, L2) was prototyped: on Ghostbuster hold-out it raised AI caught at 0 human FPs from ~11% to ~27% (raw z), but did nothing for the newer-style corpus and isn't explainable per clue, so it was **not shipped**. Possible future option if the owner wants it.

## v6 results (Opus 5.5 study)
- `tests/data/opus55/`: 40 real Opus 5.5 answers (26 tune / 14 hold-out) + 15 "human-refined" (8/7), written by Opus 5.5 in this repo's Claude Code session after it had read the clue lists (contamination caveat in `prompts.md`).
- v5 caught **0/40** (all human-leaning; means 18–19). v6: tune 6/26, hold-out 2/14, refined 0/15. Every flagged one → "Suspected AI: Claude Opus 5.5".
- Opus 5.5 barely uses the research tells (em dashes, "This matters", "in short", "Looking ahead"). Its tells are structural. Stories, emails, essays and teen-style posts still look human.
- Humans unchanged: Ghostbuster 10/2,056, own corpus 0/216, samples 0/9. Ghostbuster AI 25.0% unchanged.

## v7 results (edited-AI check)
- Edited Opus 5.5: 6/15 → band `edited` (2/8 tune, 4/7 hold-out; the hold-out was looked at while designing, so it's optimistic). Humans: 1/2,281 → `edited` (other/ets/175), 6 more get level 1 (note only). Humans flagged ≥55 unchanged.
- Limits: edited stories and essays are rarely caught. Real casual human school answers are missing from the test data, so false alarms on teens may be higher than measured.

## v8 (Mixed-rule fix)
- The owner supplied their own Year 10 English essay (To Kill a Mockingbird, 807 words incl. their notes). Score 28 human-leaning, but the old Mixed rule fired (window max 77 on the conclusion: "In conclusion", 3 trailing -ing clauses). Not committed (it's the owner's own school work and the repo is public).
- Measuring "Mixed" on real humans for the first time showed 76/2,056. Fixed with `mixedCheck` (above). Demo mixed sample's AI paragraph got "Moreover," so it still demonstrates Mixed (75 vs ~21).

## v9 results (bigger real-data fit)
- Ghostbuster extended to 900 files/group + `other/undetectable` (humaniser) + `other/gptzero`: 5,303 human / 4,635 AI. `fetch_ghostbuster.sh` and `eval_ghostbuster.js` updated (split ≤150 & 301–600 tune).
- Humans flagged 33 → 15 (every group ≤ v8; learners 6 → 1); AI 30.2% → 32.5%; hold-out humans 13 → 8, AI 32.1% → 34.8%. Mixed labels on humans 22 → 17 with MIXED_RULE.para 72 (synthetic pasted-AI essays 24 → 26 of ~195). Own corpus AI 21 → 20 of 53; lab and Opus unchanged.
- Remaining human false flags are mostly IvyPanda student essays heavy on "serves as", "plays a crucial role", "Moreover", even rhythm.

## v10 results (held-out benchmark, docs/benchmark.html)
- 2,339 human / 6,413 AI test texts (610 near-copies skipped). v9 → v10: recall 53.3% → 82.0%, humans flagged 9 → 3 (0.38% → 0.13%), AUC 0.907 → 0.993, PR-AUC 0.969 → 0.998, ECE 0.152 → 0.012, F1 0.695 → 0.901. Essays recall 56 → 85% (human FP 9 → 1); stories 22 → 62% (FP 0 → 2); news 5 → 49%; Claude 2023 13 → 56%; Opus 5.5 held-out 13 → 29% (7/24); paraphrased/perturbed 16–40% → 50–71%; humaniser 11 → 21% (AUC 0.995); older Claude-written imitations 48 → 29%.
- Owner's English essay: 24, "Likely human-written".
- Rejected in v10: unshrunk short texts (a 43-word human post scored 99); loose "other"-genre cut-off; gptzero as test-only (casual human Q&A was missing from training; now split 50/50); a 13% human inconclusive rate (human cut moved from the 85th to the 95th percentile); applying the specialist to whole long documents.
- Opus 5.5 data now: 70 texts (46 train / 24 test) + 15 edited. All written by Opus 5.5 in this repo's session (contamination caveat in `tests/data/opus55/prompts.md`).

## v11 results (held-out benchmark)
- Humans flagged 3 → 2 (0.09%; essays 0, learners 0, two Reddit stories), recall 82.0 → 83.3%, AUC 0.993 → 0.995, F1 0.901 → 0.909, humans inconclusive 4.2 → 3.5%. Opus 5.5 held out 36% (14/39), edited Opus 40% (6/15), humaniser 28% (wrong: data bug, see v12.1), Claude 2023 57%.
- Attribution (when a model is named): ChatGPT 99%, Claude 2023 91%, Opus 5.5 88%, humanised ChatGPT 97% (old rule clues: 2–28%).
- Rejected in v11: word-class bigram profile (no consistent gain; code kept, `useClass` off); 99.3rd-percentile cut-off (0.7% FP after retraining, as the percentile implies); Opus weight 16/30 (no gain / more FP); model-based Mixed rule (no better); looser "other"-genre cut (its top human OOF scores are ordinary prose).
- Opus 5.5 data: 110 texts (71 train / 39 test) + 15 edited.
- Genre classifier (`model.json.genreModel`, softmax over style + token features, 84.6% held-out vs 35.9% heuristic) sets `r.genre` for display only; cut-offs use `r.cutGenre` = heuristic `guessGenre` (using the classifier for cut-offs made results worse: FP 2→3, news recall 60→46%).
- Rejected: training-time augmentation (`tests/lib/augment.js`, kept for reference): recall 83→78%, every perturbation category worse.

## v12 results
- Hashed character 3-grams (512 buckets, `useChr` in `model.json`; `stats.js` computes `sf.chr`) added to the general model. Cut-offs now at the 99.9th / 99.95th percentile (`hiPct` 0.999, `genrePct` 0.9995): at 99.8 v12 flagged one more reformatted human essay (essay:790 with short lines removed) than v11.
- Held-out: humans flagged 2 (same two Reddit stories); reformatted human texts (benchmark `reformatted`) 1 + 1 (v9: 12 + 8); humans inconclusive 2.8%; recall 82.3% (v11 83.3%); AUC 0.996; sentence paraphrase 57%, sentence edits 57%; Opus 36%, edited Opus 40%, humaniser 28% (wrong: data bug, see v12.1).
- Owner's essay: 49, "Likely human-written" (close to the 50 line).
- In the explanation panel the 512 character patterns are summed into one row ("letter and punctuation patterns").

## v12.1 (Nov 2026): corrected benchmark, no model change
- **Data bug fixed:** since v9 the loaders (`tests/lib/datasets.js`, `tests/eval_ghostbuster.js`) also read Ghostbuster `logprobs/` token-probability tables as texts (~200 in `other/undetectable` = "humaniser AI", ~100 in `other/gptzero` = "human"). Walks now accept only `/^[0-9]+\.txt$/` and skip `logprobs`. Every humaniser figure before v12.1 (11–28%) is wrong; real v12 humaniser recall = 91.4% (32/35 test, AUC 1.000).
- **ASAP** (US grades 7–10, 2012, 12,431 essays): `bash tests/data/fetch_asap.sh` → `tests/data/samples/asap.jsonl` (gitignored), every row `split: test`. **Test-only on purpose** (see rejected below).
- The Ghostbuster folders hold 1,000 texts each (BAWE 1,444; Reuters 20 per journalist); `fetch_ghostbuster.sh` asks for more, which is harmless. Split: n ≤ 150 or 301–600 train; n > 900 → `n % 5 < 3` train.
- Benchmark, v12 (24,179 test docs, 947 near-copies skipped; 15,419 human / 7,082 AI): humans flagged 10 (0.06%) = 8 ASAP (sets 3, 4, 5, 7) + 2 Reddit stories; other essays 0/1,078; learners 0/953; reformatted 10 + 9; inconclusive humans 1.2%; recall 81.2%; AUC 0.996; PR-AUC 0.994; F1 0.896; ECE 0.016. Essays 84%, stories 60%, news 58%, humaniser 91%, Claude 2023 54%, Opus 36%, edited Opus 40%, prompt variants 91%, perturbed 57–76%. v9 on the same data: 24 flagged (15 ASAP), recall 50.1%.
- **Rejected v13 candidates:** (1) neutral essay conventions in training (`opts.neutral`, off): recall 81 → 69%, owner essay (body only) 84 → 98 "ai". (2) ASAP in training with three cut-off rules: one flagged a new essay/human text, one moved the owner essay to 68 inconclusive, one dropped recall to 73%. (3) data-only retrain (more Ghostbuster): fewer FPs but recall 64.5%; at equal test FP v12 ranks better (84.4% vs 74.3% at FP 0).

## v12.3 (Nov 2026): specialist-only retrain with Opus batch 4
- `tests/data/opus55/batch4_tune.txt` (24) / `batch4_holdout.txt` (12): advice, reviews, tips, reflections, speeches, emails, explanations, stories, essays, news. v12.2 caught 13/36 before retraining.
- `datasets.js` docs carry `fileNo`; `V12DATA=1` makes `train.js` skip train files > 900 (Reuters > 6), i.e. the v12-era download (the test split is unchanged). Logprob tables are no longer in training either.
- Full retrain (`V12DATA=1 node tests/train.js`) **rejected**: humans flagged 3 → 6 (essay/human +1, asap/set5 +1, asap/set6 +1), recall 81.2 → 76.0%, essays 84 → 75%, news 58 → 45%; Opus held out 35 → 55%. Higher cut-offs (other 0.9993).
- **Shipped:** v12.2 general, humaniser, attribution and genre models + `claude-modern` retrained on 95 Opus texts (cut 0.9304, was 0.9139): `V12DATA=1 SPECIALIST_ONLY=1 node tests/train.js` (~1 min, reproduces `src/model.json` exactly). Benchmark: humans flagged 2 (two Reddit stories; ASAP 0); reformatted 3 + 0; recall 81.27% (7,094 AI); AUC 0.996; Opus held out 27/51 = 53% (earlier 39: 19 = 49%, was 14; batch 4: 8/12, was 4); edited Opus 5/15 (was 6); claude-imitation 48% (was 38%); Mixed 10/405 unchanged; owner essay 49 human; Test lab 6/11 AI, 0/9 humans.
- **A full `node tests/train.js` no longer reproduces the shipped model.** Use the two-step recipe (the v12.2 general model is in git history: `git show 6eeaa80:src/model.json`).

## v12.2 (Nov 2026): short-text rule for the recent-Claude specialist
- All 10 held-out human FPs in v12.1 came from `claude-modern` (general p 0.05–0.93); 8 were ASAP answers of 46–158 words. New specialist fields `minWords` (150) and `shortMinGeneral` (0.5) in `model.json` (set in `train.js`): under `minWords` the specialist needs general p ≥ `shortMinGeneral`. Humaniser specialist unchanged (a floor there only lost AI).
- Benchmark: humans flagged 10 → 3 (ASAP 8 → 1 = set5 158 words; 2 Reddit stories with general p 0.93 / 0.59); reformatted 3 + 2; recall 81.23% (same 5,753 TPs); Opus 36%, edited 40%, humaniser 91%; Test lab 6/11 AI, 0/9 humans; owner essay 49 human.
- Chosen while looking at the ASAP FPs, so the ASAP figure is optimistic for this rule. A hard 150-word floor gave the same 3 FPs but dropped short Claude imitations 38% → 5% and Test lab AI 6/11 → 2/11: rejected.

## Decisions and rejected ideas
- **v5 fairness fixes (from real learner essays):** "I hope this helps" is a stock phrase, not a certain giveaway (a Reddit writer used it); "I think" doesn't count as casual for the too-clean rule; the hopeful-ending clue needs dialogue or fiction clichés; lists of -ing words aren't trailing clauses; each AI word counts at most twice and tier-1 everyday words count half; "Copy code" only counts on its own line.
- **Rejected:** contractions as an AI sign. An automatic logistic fit wanted it only because the human corpus was formal; it would flag real teens.
- **Rejected:** nominalisation rate (-tion/-ment) and word length. Genre-confounded, and unfair to formal and non-native writers.
- **Rejected:** a neural model (couldn't run or test one).
- **Weakened (version-aware):** em dashes, "genuinely", "not X, it's Y".
- Markdown counts only a little for detection (a human README with bold text was wrongly flagged when it counted more), but strongly for attribution.
- `[name]`-style placeholders only count when they look like "[Your Name]" or "[Insert …]", because docs use `[name]` as syntax.
- A missing final full stop only counts as a human slip when the last line is over 6 words (email sign-offs like "Best, Alex" were being counted).

## Known weak spots / next steps
0. **v10 next steps:** real GPT-5/6, Gemini, DeepSeek and Llama samples via `tests/data/samples/` (no API keys were available); real Claude output from claude.ai collected without detector context; real human-edited AI text; more casual human writing (the genre guess often misses Reddit stories, so 11% of them land in "inconclusive"); a neural perplexity feature only if it can run and be tested in the page.
1. **Tune on real modern data.** Ghostbuster (2023 models) is now used; still needed: real 2026 ChatGPT/Claude output and real teen writing. The owner is collecting real ChatGPT output, Claude output, their own writing and friends' casual writing, and will paste Test lab results. Use them to re-fit weights. Keep human false positives at 0 and check the human max score stays well below 55.
2. AI told to write like a teen with lowercase starts and slang currently looks human (slips outweigh everything). Any fix must not flag real teens. Only change it with real teen text to test against.
3. AI emails are mostly missed; plain AI emails look like competent human emails.
4. Attribution is only checked on 11 imitations. Validate it on real outputs, and consider Gemini/Grok fingerprints if real samples arrive.
5. Short texts (<150 words) are unreliable by design.
6. Clue lists drift with model releases. Revisit when new Claude/GPT versions ship (check Pangram, Graphite and Arena write-ups).

## Also exists
A private claude.ai artifact copy of the same page, owned by the user. The repo's `index.html` is the canonical version.

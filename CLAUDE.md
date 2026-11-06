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
5. **Don't add a neural model unless it can actually be tested working.** Not done so far; it couldn't be tested in the build environment.
6. **Never accept a tuning change that wrongly flags more human text.** False positives on real people (especially teens and non-native writers) matter more than catching more AI.
7. Detect any AI model, but be especially good at Claude and ChatGPT, and say which one a text looks more like (Claude-leaning / ChatGPT-leaning / other or can't tell).

## How to build and test
- **Edit `src/`, never `index.html`.** Run `python3 build.py` to regenerate `index.html` (it inserts `src/core.js` between the `// ==CORE==` markers and `src/testlab_samples.txt` as a JSON string).
- `node tests/lab.js [file] [cutoff]` runs Test lab-format files (`---`-separated, label on the first line: Human/Claude/ChatGPT/AI).
- `bash tests/data/fetch_ghostbuster.sh` then `node tests/eval_ghostbuster.js tune|holdout|all` scores **real** human text (student essays, Reddit stories, Reuters, English-learner essays) and **real** ChatGPT/Claude 2023 output (Ghostbuster dataset, CC BY 3.0, gitignored). Tune on `tune`, check `holdout` once.
- `python3 tests/data/make_dataset.py && node tests/eval_corpus.js` scores the larger corpus. The machine-collected human part (`human.json`, `dataset.json`) is gitignored because it's other projects' text under their licences; `build_human.py` has Linux paths from the original environment and may need adjusting.
- No npm or pip packages are required.
- For a visual check, open `index.html` in a browser and click each sample button, the Compare example and "Load 20 sample passages" in the Test lab. There should be no console errors.

## Architecture (src/core.js)
- `cleanText(raw)` → `{text, notes}`: strips zero-width and hidden characters, normalises odd spaces, converts full-width characters, folds Cyrillic/Greek look-alikes **only inside words that also contain Latin letters**, and straightens quotes. The page shows a notice from `notes`.
- `features(text)` → rates for ~25 clues plus `counts` (for UI text) and `hits` (highlight ranges: `{start, end, type, label}` with types `hard | word | phrase | struct | trans`).
- `MODEL` = `{bias, w, cap}`: logistic model `z = bias + Σ w·min(f, cap)`. Current bias **-2.0**. v5 weights = 70% v4 hand-set + 30% a constrained logistic fit (humans weighted 3×, signs kept) on the Ghostbuster tune half plus this repo's corpus.
- `analyze(text, {noShrink})` → `score` (0–100, shrunk towards 50 for short texts: confidence from 40→300 words), `band` (`human` <35, `inconclusive` 35–54, `ai` ≥55; any hard giveaway with score ≥45 → `ai`), `contrib`, `hits`, `counts`.
- `attribute(text, r)` → `{claude, gpt, lean, confidence, ev}` from `CLAUDE_FP` / `GPT_FP` regex lists plus formatting rules (bold labels, headers, emoji → GPT; plain bullets without bold, spaced em dash, short even sentences → Claude). `lean` needs total ≥2 and margin ≥1.5. Confidence is "medium" only if margin ≥4 and total ≥5. It's only shown when score ≥45.
- `suspect(text, r, attr)` → `{short, label, detail, version, confidence}`: the "Suspected AI" line shown on every result. "No AI suspected" below 35 (unless mixed), otherwise a model from `attribute`'s lean plus a version hint: Claude with em dashes ≥3/1,000 words or "genuinely" → older Claude, else Claude Opus 5.5; ChatGPT with "may provide"/"not necessarily" → GPT-5/6 era, with "delve"/"tapestry" → GPT-4 style, else "ChatGPT or a model like it".
- **Opus 5.5 answer shape** (`shape` in `features`): 5 habits (label-style paragraphs, colon + plain list, one-sentence opening paragraph with 3+ more, "that's why", "the good news is"/"depends on"). `shape` = 0 for 0–1 habits, 0.3 for 2, N−1 for 3+; weight 1.5. Also +N to Claude in `attribute`. Measured on `tests/data/opus55/tune.txt` vs 2,281 human texts (3+ never in humans).
- **Edited-AI check** (`edited` in `counts`, 0/1/2, plus `edHumanEv` / `edSkelEv`): casual touches (casual words, dropped apostrophes, personal story) vs leftover AI skeleton (enumerated causes/stages, "that's why", good-side/bad-side or decision-rule framing, textbook definition opener, shape habit, AI words/phrases). Skipped for narratives (3+ "I/we/he/she was/had/said…"). Level 2 = 2+ of each → `analyze` sets band `edited` and score max(score, 45); `rawScore` keeps the original. Level 1 = a note only. Never pushes to ≥55 (hard requirement 6). `suspect` returns "Possibly AI that a person has edited".
- `paraSplit(text)`: blank-line paragraphs, or single lines when there are no blank lines (used by the shape clue; the evenness clue still uses blank-line paragraphs only, because switching it flagged one more human).
- `segments(text)`: paragraph sections (or ~110-word sentence runs), each scored with `analyze`.
- `slidingWindow(text)`: ~90-word half-overlapping windows scored with `noShrink`. Each sentence gets the average of the windows covering it. The UI shades sentences ≥65. The page sets band `mixed` if window max ≥70 and min ≤35 (or section hi ≥65 and lo ≤35) and the band isn't already `ai`.
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
1. **Tune on real modern data.** Ghostbuster (2023 models) is now used; still needed: real 2026 ChatGPT/Claude output and real teen writing. The owner is collecting real ChatGPT output, Claude output, their own writing and friends' casual writing, and will paste Test lab results. Use them to re-fit weights. Keep human false positives at 0 and check the human max score stays well below 55.
2. AI told to write like a teen with lowercase starts and slang currently looks human (slips outweigh everything). Any fix must not flag real teens. Only change it with real teen text to test against.
3. AI emails are mostly missed; plain AI emails look like competent human emails.
4. Attribution is only checked on 11 imitations. Validate it on real outputs, and consider Gemini/Grok fingerprints if real samples arrive.
5. Short texts (<150 words) are unreliable by design.
6. Clue lists drift with model releases. Revisit when new Claude/GPT versions ship (check Pangram, Graphite and Arena write-ups).

## Also exists
A private claude.ai artifact copy of the same page, owned by the user. The repo's `index.html` is the canonical version.

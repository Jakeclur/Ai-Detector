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
- `python3 tests/data/make_dataset.py && node tests/eval_corpus.js` scores the larger corpus. The machine-collected human part (`human.json`, `dataset.json`) is gitignored because it's other projects' text under their licences; `build_human.py` has Linux paths from the original environment and may need adjusting.
- No npm or pip packages are required.
- For a visual check, open `index.html` in a browser and click each sample button, the Compare example and "Load 20 sample passages" in the Test lab. There should be no console errors.

## Architecture (src/core.js)
- `cleanText(raw)` → `{text, notes}`: strips zero-width and hidden characters, normalises odd spaces, converts full-width characters, folds Cyrillic/Greek look-alikes **only inside words that also contain Latin letters**, and straightens quotes. The page shows a notice from `notes`.
- `features(text)` → rates for ~25 clues plus `counts` (for UI text) and `hits` (highlight ranges: `{start, end, type, label}` with types `hard | word | phrase | struct | trans`).
- `MODEL` = `{bias, w, cap}`: logistic model `z = bias + Σ w·min(f, cap)`. Current bias **-1.9**.
- `analyze(text, {noShrink})` → `score` (0–100, shrunk towards 50 for short texts: confidence from 40→300 words), `band` (`human` <35, `inconclusive` 35–54, `ai` ≥55; any hard giveaway with score ≥45 → `ai`), `contrib`, `hits`, `counts`.
- `attribute(text, r)` → `{claude, gpt, lean, confidence, ev}` from `CLAUDE_FP` / `GPT_FP` regex lists plus formatting rules (bold labels, headers, emoji → GPT; plain bullets without bold, spaced em dash, short even sentences → Claude). `lean` needs total ≥2 and margin ≥1.5. Confidence is "medium" only if margin ≥4 and total ≥5. It's only shown when score ≥45.
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

## Current results (v4)
- 216 real human passages (docs, READMEs, Go spec, Newton, GPL, public-domain literature): **0 flagged at 55**, max 42, 9 inconclusive.
- 53 AI passages by style (cut-off 55): classic ChatGPT essays 100%, modern answers ~55%, stories ~40%, emails ~15%, AI-as-teen ~10%. Hold-out set: 9/20.
- Built-in 20 samples: AI 8/11 caught, humans 0/9 flagged, model guess 8 right, 0 wrong, 3 can't tell. **In-sample**: fiction clues were added after seeing the ChatGPT-style story.
- Mixed essay (3 human paragraphs + 1 AI paragraph): overall 25 → band "Mixed"; AI section 67; window max 76; max human window in corpus 39.
- **Bias warning:** all AI text was written by Claude, "ChatGPT" passages are imitations, the 9 everyday human samples are Claude imitations, and there's no real teen or casual human text.

## Decisions and rejected ideas
- **Rejected:** contractions as an AI sign. An automatic logistic fit wanted it only because the human corpus was formal; it would flag real teens.
- **Rejected:** nominalisation rate (-tion/-ment) and word length. Genre-confounded, and unfair to formal and non-native writers.
- **Rejected:** a neural model (couldn't run or test one).
- **Weakened (version-aware):** em dashes, "genuinely", "not X, it's Y".
- Markdown counts only a little for detection (a human README with bold text was wrongly flagged when it counted more), but strongly for attribution.
- `[name]`-style placeholders only count when they look like "[Your Name]" or "[Insert …]", because docs use `[name]` as syntax.
- A missing final full stop only counts as a human slip when the last line is over 6 words (email sign-offs like "Best, Alex" were being counted).

## Known weak spots / next steps
1. **Tune on real data.** The owner is collecting real ChatGPT output, Claude output, their own writing and friends' casual writing, and will paste Test lab results. Use them to re-fit weights. Keep human false positives at 0 and check the human max score stays well below 55.
2. AI told to write like a teen with lowercase starts and slang currently looks human (slips outweigh everything). Any fix must not flag real teens. Only change it with real teen text to test against.
3. AI emails are mostly missed; plain AI emails look like competent human emails.
4. Attribution is only checked on 11 imitations. Validate it on real outputs, and consider Gemini/Grok fingerprints if real samples arrive.
5. Short texts (<150 words) are unreliable by design.
6. Clue lists drift with model releases. Revisit when new Claude/GPT versions ship (check Pangram, Graphite and Arena write-ups).

## Also exists
A private claude.ai artifact copy of the same page, owned by the user. The repo's `index.html` is the canonical version.

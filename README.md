# AI Text Detector

An AI-writing detector that runs entirely in your web browser. Since v10 it combines hand-written writing-habit clues with small statistical classifiers (logistic regression and boosted decision trees) trained and tested on about 20,000 real human and AI texts. Paste some writing (or upload a `.txt` or `.docx` file) and it shows:

- an **AI likelihood estimate** (0–100, calibrated), a **Likely human-written / Inconclusive / Mixed / Likely AI-generated** result, a **confidence** level (low or medium, never high) and an **evidence quality** rating, with the reasons for any uncertainty
- **what the trained model noticed**, in plain English, and a **paragraph-by-paragraph** view
- a **Suspected AI** line at the end of every result: "No AI suspected", a model and version guess (e.g. *Claude Opus 5.5*, *older Claude*, *ChatGPT (GPT-5/6)*), or "can't tell"
- **which chatbot it looks more like**, Claude or ChatGPT, with an honest confidence level
- a **bar for every clue**, showing what pushed the score up or down
- **highlights in the text**, so you can see exactly what was flagged and why
- a **section-by-section scan**, and a **Mixed** result that shades one paragraph when it stands out as far more AI-like than the rest

It also has a **Compare** tab, which checks whether a text matches someone's known writing style, and a **Test lab** tab for testing the detector on your own labelled examples.

There is no large AI model inside (the classifiers are sets of weights small enough to ship in the page, about 220 KB), and nothing you paste is sent anywhere.

> **Important:** no detector can prove who wrote something. A high score means "look closer", never proof. A low score doesn't mean a person wrote it. Don't use this to accuse anyone.

---

## Contents

1. [Quick start](#quick-start)
2. [Features](#features)
3. [How it works](#how-it-works)
4. [The clues it uses, and the research behind them](#the-clues-it-uses-and-the-research-behind-them)
5. [Claude vs ChatGPT attribution](#claude-vs-chatgpt-attribution)
6. [How accurate is it?](#how-accurate-is-it)
7. [Limitations](#limitations)
8. [Fairness](#fairness)
9. [Project structure](#project-structure)
10. [Development: build, test and tune](#development-build-test-and-tune)
11. [Version history](#version-history)
12. [Sources](#sources)

---

## Quick start

**Use it:** download `index.html` and open it in any modern browser (Chrome, Edge, Firefox, Safari). That's all: it's one self-contained file.

**Host it online (optional):** in this repo's GitHub settings, go to *Pages*, choose "Deploy from a branch", pick `main` and `/ (root)`, and save. GitHub will give you a link to `index.html`.

**Uploading Word files** needs an internet connection the first time, because the `.docx` reader (JSZip) loads from cdnjs. Everything else works offline.

---

## Features

### Check a text
- Paste text (40+ words, ideally 150+) or upload `.txt` / `.docx`.
- **Text cleaning before checking:** removes invisible characters (zero-width spaces and similar), swaps look-alike letters back to normal ones (for example a Cyrillic "о" hidden inside an English word, a trick used to fool detectors), converts full-width characters, and straightens curly quotes. A notice tells you when this happened. Look-alike letters are only folded inside words that also contain normal Latin letters, so genuine Russian or Greek text is left alone.
- **Result bands:**

  | Score | Result |
  |---|---|
  | 0–34 | Human-leaning |
  | 35–54 | Inconclusive |
  | 55–100 | AI-leaning |
  | any | **Mixed**, when one paragraph (not the last) scores 72+ on its own and 40+ points above the median of the other paragraphs |

  Short texts are pulled towards the middle, because less text means less evidence.
- **Certain giveaways box:** leftover chatbot lines such as "As an AI language model", "Would you like me to…", "[Your Name]" or ChatGPT citation codes (`oaicite`, `utm_source=chatgpt.com`).
- **Caution box:** warns when the text is formal, very plain, mostly a list, short, or casual-but-very-tidy, because careful human writing in those styles can look AI-like.
- **Which AI does it look more like?** A Claude ↔ ChatGPT bar with the evidence for each side.
- **Section by section:** each paragraph (or ~110-word chunk) scored on its own.
- **Stand-out paragraph:** when one paragraph scores 72+ and 40+ points above the others, the result is "Mixed" and that paragraph is shaded in the flagged text.
- **Copy summary:** a plain-text summary of the result.

### Compare with known writing
Paste something the person definitely wrote, plus the text you're unsure about. It compares writing style (stylometry):
- how often they use ~70 common small words ("the", "but", "really"…), using Burrows' Delta
- sentence length and spread, contractions, "I/me/my", word length, vocabulary variety, commas, dashes, and exclamation and question marks

It reports "similar", "somewhat different" or "very different", plus the biggest differences in plain English. It works best with 300+ words of each and the same kind of writing.

### Test lab
Paste several texts separated by a line containing only `---`. Put a label on the first line of each one:

```
Human
my own writing goes here…
---
ChatGPT
a ChatGPT answer goes here…
---
Claude
a Claude answer goes here…
```

Labels can be `Human`, `Claude`, `ChatGPT` (or `GPT`/`OpenAI`), or `AI` for any other model. Press **Run tests** to get:
- a summary per group: average score, % flagged, humans wrongly flagged, AI caught, and how often the model guess was right
- a table with each text's score, result, ✓/✗ for detection and ✓/✗ for the model guess
- an **AI cut-off slider**: "auto" (far left) uses the detector's own genre-aware cut-offs; 50–99 tries a fixed likelihood cut-off, to see the trade-off between catching AI and wrongly flagging people
- **Copy results** (tab-separated), to paste back to Claude for tuning
- **Load 20 sample passages**, the built-in test set

---

## How it works

Since v10, three independent views of the text are combined:

1. **Clean** the text (hidden characters, look-alike letters, odd spaces, curly quotes).
2. **Rule engine** (`src/core.js`): about 27 hand-written writing-habit clues (listed below). It gives the clue bars and highlights, and its clue values also feed the model.
3. **Statistical features** (`src/stats.js`):
   - sentence-length distribution (mean, spread, skew, short/long shares, whether long and short sentences clump)
   - paragraph shape
   - punctuation and pronoun profiles
   - structural repetition (sentences or paragraphs that start the same way, linking-word openers)
   - semantic redundancy (word overlap between neighbouring sentences, the ending repeating the opening, repeated phrases)
   - a profile of the ~300 most common words and punctuation marks
4. **Trained classifier** (`src/model.json`, made by `tests/train.js`):
   - logistic regression over all of the above, trained on about 10,000 labelled texts, blended 50/50 (since v11) with 250 small gradient-boosted decision trees that can learn combinations of clues
   - a bootstrap ensemble of 7 logistic members; their disagreement, plus disagreement between the logistic and tree parts, is shown as the likely range
   - calibrated so the number is a fair likelihood estimate (calibration error 0.012 vs 0.152 for v9)
   - fairness rules built in: contractions, slang and slips can only push towards human; the AI-habit clues can't flip direction; human texts count twice in the training loss; vocabulary richness and word length are never scored
5. **Specialist checks:** two smaller models with their own strict cut-offs: recent Claude (Opus 5.5 vs human writing) and humaniser tools (humanised AI vs human writing). Each only counts if the main model gives at least 5% support. A third trained model, Claude vs ChatGPT, names the AI family when the text isn't judged human.
6. **Genre-aware cut-offs:** the "likely AI" and "likely human" lines are set from what real human texts *of the same type* score (essays, stories, news, explanations, emails), so formal essays are compared with other essays.
7. **Confidence, evidence and out-of-distribution checks:**
   - Short texts are pulled towards the middle.
   - Long documents are scored in ~600-word chunks and combined.
   - Unusual layouts (poems, lists of short lines) or text unlike anything in training get their estimate pulled towards 50 and can't be called "likely AI" without overwhelming evidence.
   - Confidence is only "medium" when the text is long enough, the rule engine and model agree, and the ensemble members agree. Otherwise it's "low", and it's never "high".
8. **Extras kept from earlier versions:** certain giveaways (leftover chatbot text), the edited-AI check, the Mixed paragraph check, Claude-vs-ChatGPT attribution with a version guess, and fairness cautions.

If the model file is missing or fails, the page falls back to the v9 rule engine and says so.

---

## The clues it uses, and the research behind them

### Pushes the score towards AI

| Clue | What it looks for | Why |
|---|---|---|
| **Certain giveaways** | "As an AI language model", "Would you like me to…", "If you want, I can…", "Certainly!", "[Your Name]", ChatGPT citation codes, a "Copy code" line | Text left behind when a chatbot answer is pasted unedited. ("I hope this helps" used to be here, but real people write it too, so since v5 it's an ordinary stock phrase) |
| **Measured AI words** | *delve, showcasing, underscores, tapestry, intricate, meticulous, dependable, steady, thoughtful, solace, newfound…* | Each word counts at most twice, and everyday words like "essential" or "unique" count half, because students use them too. Only words that studies **measured** against human writing: Kobak et al. (15M abstracts), Reinhart et al., and Graphite (Opus 5.5 uses "dependable" 23× the human rate). Blog-list favourites were cut, because Originality.ai found many (e.g. "delve") were rare in real ChatGPT output |
| **Stock phrases** | "plays a crucial role", "it's important to note", "This matters" (116×), "Why X matters" (92×), "Looking ahead" (40×), "adds another layer" (27×), "rather than simply" (32×), "is more than a X, it…" (98×) | Wikipedia's *Signs of AI writing*; Graphite 2026 study of Opus 5.5 |
| **Opus 5.5 answer shape** | 5 habits: label-style paragraphs ("Storage. Solar produces nothing at night…"), a colon line then a plain list, a one-sentence opening answer, "that's why", "the good news is" / "depends mostly on". Counts lightly for 2, strongly for 3+ | Measured on 26 real Opus 5.5 answers written for this project vs 2,281 human texts: 3+ together never appeared in human writing |
| **Edited-AI check** | 2+ casual touches (casual words, dropped apostrophes, a personal story dropped in) **and** 2+ leftover AI skeleton signs (textbook definition opening, "there are three main causes", "that's why", "good side / bad side" layout, an answer-shape habit, AI words). Moves a human-leaning result to **"Inconclusive: possibly edited AI"** (score at least 45), never to AI-leaning | Designed for AI text a person has "humanised". 6 of 15 edited Opus 5.5 answers vs 1 of 2,281 human texts |
| **Fiction clichés** | "for a long moment", "said quietly", "felt something shift", "paused", "stared", "in that moment", "weathered hands" | Pangram found these rose sharply in Opus 5.5 stories |
| **Tidy hopeful ending** | Stories (text with dialogue or fiction clichés) that end on "smiled", "for the first time", "hope", "together"… | Pangram: Opus 5.5 stories lean towards hope, resilience and family |
| **Email boilerplate** | "I hope this email finds you well", "I wanted to follow up", "Please don't hesitate to reach out", "Thank you for your time and consideration" | Common AI email openers and closers. Each counts only a little, more when an opener and closer appear together |
| **"Not X, it's Y" contrasts** | "It's not just a tool, it's a movement", "isn't X. It's Y" | Wikipedia's top tell. **Weakened**: Opus 5.5 uses 28% fewer negations than Opus 5 |
| **Chatbot framing** | Sentences opening "The key is", "Here's", "That's why", "Short answer", "In short" | Assistant answer style |
| **Trailing -ing clauses** | ", highlighting its importance" (lists like "reading, writing and drawing" don't count) | Reinhart et al.: instruction-tuned AI uses these 2–5× more than people |
| **Formal transitions** | Sentences starting "Moreover", "Furthermore", "Additionally", "Ultimately" | Classic ChatGPT style |
| **Summary closers** | "In short", "In summary", "Overall", "The bottom line" near the end | Pangram: Opus 5.5 summary markers up ~10× and "in short" up 11× vs Opus 5 |
| **Vague attributions** | "experts suggest", "studies show", "it is widely believed" | Wikipedia: AI cites unnamed authorities |
| **Hedging** | "may", "often", "typically", "it depends", "not necessarily" | Small weight. Pangram: caveat markers up 23% in Opus 5.5; GPT-6 overuses "may provide", "not necessarily" |
| **Generic praise words** | "amazing", "valuable", "meaningful", "seamless", "transformative" | Promotional tone |
| **Bullets, headings, bold** | Markdown density, plus "Introduction:" / "Conclusion:" label lines | Small weight, because human notes and docs use them too |
| **Colons** | Colons introducing a point | Very small weight. Opus 5 used 6.1 per 1,000 words, Opus 5.5 only 1.6 |
| **Rule of three** | "A, B, and C" lists | Small weight |
| **Em dashes** | — | **Very small and version-dependent**: Opus 5 used about 3–13 per 1,000 words, Opus 5.5 almost none, and GPT-5 still often uses them. Mainly used to guess the model (see below) |
| **Few concrete specifics** | Few names, numbers or quotes per 100 words | Absence clue, very small weight |
| **Overly even tone** | Very uniform sentence and paragraph lengths, with no ! or ? | Pangram: Opus 5.5 sentences are shorter and more uniform (spread 0.53 → 0.48) |
| **Casual but too clean** | Sounds casual ("honestly", "kind of", slang; "I think" doesn't count) but has no slips at all, even rhythm and a generic or moral ending | Targets AI told to "write like a teen". Moderate weight, and shows its own caution note |
| **Neat moral ending** | Last sentence like "It's all about balance" or "That's what matters most" | Stock wrap-up |

### Pulls the score towards human
| Clue | What it looks for |
|---|---|
| **Human slips** | Missing apostrophes ("dont", "im"), lowercase "i", lowercase sentence starts, slang ("lol", "ngl", "tbh"), "!!", double spaces, no full stop at the end |
| **Sentence rhythm** | Very uneven sentence lengths, including very short (≤3 words) or very long (≥45 words) ones |
| **In-text citations** | "(Smith, 2020)", "(Han 2)". In 65% of real student essays but only 1–2% of chatbot essays (v9). AI asked to "use APA referencing" could still add them, so the weight is moderate |

### Deliberately not used
- **Vocabulary richness and word length.** These are what make commercial detectors flag non-native English writers (see [Fairness](#fairness)).
- **Contractions as an AI sign.** An automatic fit wanted this, but only because the human test texts were formal. It would have flagged real teenagers.
- **A neural/AI model.** The page can't run one, and none could be tested in this environment.

---

## Claude vs ChatGPT attribution

Each family has its own fingerprint clues. The detector adds them up and shows a bar from Claude to ChatGPT.

| Claude clues | ChatGPT clues |
|---|---|
| "This matters", "Why X matters", "Looking ahead", "adds another layer", "what comes next", "rather than simply", "is more than a X, it…" (Graphite, Opus 5.5) | "certainly", "Overall,", "such as" (Idiosyncrasies paper) |
| "in short" (11× more in Opus 5.5), "the core idea", "perhaps the most" | "Below is", "Here's a breakdown" |
| "dependable", "steady", "thoughtful" | "If you want, I can…", "Would you like me to…", "Absolutely!", "Great question" |
| "based on the text", "according to the passage" (Idiosyncrasies paper) | "I hope this email finds you well", "let's dive in" |
| "genuinely", "the honest answer" (Opus 5-era, weak) | delve / tapestry / "in today's digital…" (GPT-4 era) |
| Opus 5.5 fiction habits ("for a long moment", "paused") | "may provide", "not necessarily" (GPT-6 era) |
| Plain bullet lists with no bold | Bold labels on list items, headers titling the answer, emoji |
| Spaced em dashes ( — ) | Unspaced em dashes (word—word) |
| Short, even sentences (~10–13 words) | Long sentences (19+ words); "Ultimately," "on the other hand", "plays a crucial role" |

**Rules:**
- It's only shown when the AI score is 45+ (or a giveaway was found).
- It says "Claude-leaning" or "ChatGPT-leaning" only when there are at least 2 points of clues and a margin of at least 1.5; otherwise "Other model, or can't tell".
- Confidence is only ever **low** or **medium**, never high.
- "ChatGPT-leaning" comes with a note that other models (Gemini, Grok, DeepSeek, Llama…) often write like ChatGPT. The Idiosyncrasies paper found models trained on ChatGPT output end up writing like it.

---

## How accurate is it?

### v12: character patterns, stricter cut-off
v12 adds 512 hashed character-pattern features (three-character sequences such as "ing", "tio" and ", t"), which capture spelling, morphology and punctuation habits. In a matched test with zero held-out humans flagged, they raised AI caught from 81.9% to 85.6% (humaniser text 46% → 67%).

The released model uses a stricter cut-off (the 99.9th percentile of human scores). At the 99.8th percentile, v12 flagged one more reformatted human essay than v11, and that's not allowed.

| Held-out | v11 | v12 |
|---|---|---|
| Humans wrongly flagged (2,339) | 2 | 2 |
| … same texts with short lines removed / on one line | 3 | **2** |
| Humans landing in "inconclusive" | 3.5% | **2.8%** |
| AI caught, overall | 83.3% | 82.3% |
| Sentence-level rewording / edits | 53% / 49% | **57% / 57%** |
| Claude Opus 5.5 / edited Opus | 36% / 40% | 36% / 40% |
| Stories / Claude (2023) | 63% / 57% | 60% / 54% |
| ROC-AUC | 0.995 | **0.996** |

So v12 trades about 1 point of overall recall for fewer people flagged or left in the grey zone, and for better resistance to rewording. The owner's essay scores 49, "Likely human-written", just under the 50 line.

### v12.3 (current): recent-Claude specialist retrained with 24 more Opus 5.5 texts
I wrote a fourth batch of 36 Opus 5.5 texts (24 for training, 12 held out), aimed at the kinds of writing most often missed: advice, reviews, tips, reflections, speeches, emails and explanations. Before any retraining, v12.2 caught 13 of the 36, which matches its 36% on the earlier held-out Opus texts.

Two ways of using the new texts were tested:
- **Full retrain:** held-out Opus 35% → 55%, but humans flagged rose 3 → 6 (a university essay and two school essays) and overall recall fell 81% → 76%. **Rejected.**
- **Retrain only the recent-Claude specialist** and keep everything else from v12.2: **shipped.**

| Held-out | v12.2 | v12.3 |
|---|---|---|
| Real human texts wrongly flagged (15,419) | 3 | **2** (two Reddit stories) |
| … ASAP school essays (12,428) | 1 | **0** |
| … same texts with short lines removed / on one line | 3 / 2 | 3 / **0** |
| AI caught, overall (7,094) | 81.2% | **81.3%** |
| **Claude Opus 5.5, earlier held-out texts (39)** | 36% | **49%** |
| Claude Opus 5.5, new held-out batch (12) | 33% | 67% |
| Opus 5.5 edited to sound like a student (15) | 40% | 33% |
| ROC-AUC | 0.996 | 0.996 |

**Later the same day (v12.4 attempt, rejected):** 23 more Opus 5.5 texts were written and used to retrain the specialist again. Humans flagged rose 2 → 4 (a university essay and a school essay) and held-out Opus fell 53% → 51%, so v12.3 was kept. Those 23 texts became extra test data instead: v12.3 catches 10 of them (43%). Across all 74 held-out Opus 5.5 texts, v12.3 catches **50%**. Overall: 2 of 15,419 humans flagged, 81.1% of 7,117 AI texts caught.

The 39 earlier texts are the fairer measure, because the new held-out batch was written alongside the new training texts. One edited Opus text is no longer caught. The usual caveat applies: all the Opus 5.5 texts were written in this project's own session, by a model that knew they were for a detector. Rebuild with `V12DATA=1 SPECIALIST_ONLY=1 node tests/train.js` (about 1 minute).

### v12.2: stricter recent-Claude specialist on short texts
All 10 people still wrongly flagged in the re-test below were flagged by the **recent-Claude specialist**, not by the main model. For 8 of them, short school answers of 46–158 words, the main model gave only 5–41%. Now, on texts **under 150 words**, the specialist only counts if the main model gives at least 50%. Nothing was retrained.

| Held-out, corrected data | v12.1 | v12.2 |
|---|---|---|
| Real human texts wrongly flagged (15,419) | 10 | **3 (0.02%)** |
| … ASAP grade 7–10 school essays (12,428) | 8 | **1** |
| … Reddit stories (490) | 2 | 2 |
| … same texts with short lines removed / on one line | 10 / 9 | **3 / 2** |
| AI caught, overall (7,082) | 81.2% | 81.2% (the same 5,753 texts) |
| Claude Opus 5.5 / edited Opus / humaniser | 36% / 40% / 91% | 36% / 40% / 91% |
| Built-in Test lab samples | 6 of 11 AI, 0 of 9 humans | 6 of 11 AI, 0 of 9 humans |

**Honest caveat:** this rule was found by looking at the ASAP false flags, so the ASAP figure for it is optimistic. The other test groups were not used to choose it, and none of them got worse. A plain 150-word floor was also tried. It gave the same 3 false flags but missed most short Claude-written test texts (38% → 5%), so the softer rule was kept.

### v12.1 re-test (Nov 2026): data fix and 12,428 more student essays
Two things changed in the test data, not the model:

1. **A data-loading bug was fixed.** Since v9, the loader had also read the Ghostbuster dataset's token-probability tables (files in `logprobs/` folders) as if they were texts. That put about 200 tables of numbers into the "humaniser AI" group and about 100 into the GPTZero "human" group. The humaniser results reported for v9–v12 (11–28%) were mostly measuring those tables. On the real humaniser texts, v12 catches **91%** (32 of 35 held-out texts; ranking AUC 1.000). The test set is small, and it all comes from one tool (undetectable.ai, 2023).
2. **12,428 real school essays were added as a test-only fairness check:** the ASAP set (US students in grades 7–10, written in 2012, before ChatGPT existed). They're never used for training (`bash tests/data/fetch_asap.sh`, not committed).

| Held-out, corrected data | v9 rules | v12 |
|---|---|---|
| Real human texts | 15,419 | 15,419 |
| … wrongly flagged | 24 (0.16%) | **10 (0.06%)** |
| … ASAP grade 7–10 school essays flagged (12,428) | 15 | **8** |
| … other student / university essays flagged (1,078) | 9 | **0** |
| … English-learner essays flagged (953) | 0 | 0 |
| … Reddit stories flagged (490) | 0 | 2 |
| … same texts with short lines removed / on one line | 28 / 23 | **10 / 9** |
| Humans landing in "inconclusive" | 2.5% | **1.2%** |
| AI caught, overall (7,082) | 50.1% | **81.2%** |
| AI essays / stories / news | 56% / 22% / 8% | **84% / 60% / 58%** |
| Humaniser-tool AI news (35) | 34% | **91%** |
| Claude (2023) | 11% | **54%** |
| Claude Opus 5.5, held out (39) / edited Opus (15) | 8% / 0% | **36% / 40%** |
| Paraphrased / perturbed AI news | 16–38% | **57–76%** |
| ROC-AUC / PR-AUC | 0.874 / 0.866 | **0.996 / 0.994** |
| F1 / calibration error | 0.666 / 0.166 | **0.896 / 0.016** |

About 1 in 1,500 real school essays was still wrongly flagged (8 of 12,428). That's rare, but not zero, which is why a high score must never be treated as proof.

**Tried and rejected after this test (v13 candidates):**
- **Treating essay conventions ("In conclusion", "Firstly", "Moreover") as neutral in training.** AI caught fell 81% → 69%, and the owner's own essay (body only) went from "inconclusive" to "likely AI". Code kept, switched off.
- **Training on the ASAP essays as well.** Three cut-off rules were tried. One flagged a new university essay, one moved the owner's essay into "inconclusive", and one dropped AI caught to 73%. So ASAP stays test-only.
- **Retraining on more Ghostbuster texts without ASAP.** Fewer people flagged, but AI caught fell to 65%. At an equal false-flag rate, v12 still ranked better (84% vs 74% caught with zero humans flagged), so v12 was kept.

### v11: held-out benchmark (`node tests/benchmark.js`, dashboard in `docs/benchmark.html`)
Test half only: 2,339 human and 6,428 AI texts, split by prompt group, with 610 near-copies of training documents skipped.

| Metric (overall) | v9 | v10 | v11 |
|---|---|---|---|
| Accuracy | 0.657 | 0.868 | **0.878** |
| Precision | 0.997 | 0.999 | **1.000** |
| Recall (AI caught) | 0.533 | 0.820 | **0.833** |
| F1 | 0.695 | 0.901 | **0.909** |
| Humans wrongly flagged | 9 (0.38%) | 3 (0.13%) | **2 (0.09%)** |
| ROC-AUC | 0.907 | 0.993 | **0.995** |
| PR-AUC | 0.969 | 0.998 | **0.998** |
| Calibration error | 0.152 | 0.012 | 0.014 |
| Humans landing in "inconclusive" | 2.7% | 4.2% | 3.5% |

| Slice | v9 | v11 |
|---|---|---|
| Student + university essays: recall / humans flagged | 56% / 9 | **85% / 0** |
| Reddit stories: recall / humans flagged | 22% / 0 | 63% / 2 |
| Reuters news: recall / humans flagged | 5% / 0 | **60% / 0** |
| English-learner essays flagged (875) | 0 | 0 |
| **Claude Opus 5.5, held out (39 texts)** | 8% | **36%** |
| **Opus 5.5 edited to sound like a student (15)** | 0% | **40%** |
| Claude (2023) | 13% | 57% |
| Humaniser-tool AI news (see the v12 re-test: these figures were affected by a data bug) | 11% | 28% |
| Paraphrased / perturbed AI news | 16–40% | 49–73% |

**Which AI (Claude vs ChatGPT), when the detector names a model:**

| AI texts | v9 right | v11 right | v11 wrong |
|---|---|---|---|
| ChatGPT (gpt-3.5) | 21% | **99%** | 0.6% |
| Claude (2023) | 3% | **91%** | 5% |
| Claude Opus 5.5 | 16% | **88%** | 8% |
| ChatGPT run through a humaniser | 4% | **97%** | 3% |
| ChatGPT (GPTZero set) | 2% | **96%** | 0% |

What changed in v11:
- **Gradient-boosted trees** blended 50/50 with the logistic ensemble. They can combine clues (for example, a clue that only matters in stories). At an identical false-flag level they caught more AI, especially Claude and humaniser text.
- **A trained Claude-vs-ChatGPT attribution model.**
- **A humaniser specialist** alongside the recent-Claude one. Each specialist only counts if the main model gives at least 5% support, which stopped a Reddit dialogue story being flagged (main model 0, specialist 0.92).
- **"Likely human" means an estimate below 50**, or the 95th percentile of real human scores if that's higher. This halved the real people left in "inconclusive".
- **Version hints come from the recent-Claude model.** 76% of 2023 Claude texts are now called "older Claude"; 23 of 25 flagged Opus 5.5 texts are called "Claude Opus 5.5".
- **40 more Opus 5.5 samples** (110 + 15 edited in total).

**Also in v11 (later the same day):** a trained genre classifier (right 84.6% of the time on held-out texts, vs 35.9% for the old hand-written genre guess) now picks the "Type of writing" shown on the page. It isn't used for the cut-offs: that was tested, and it made results slightly worse (2 → 3 humans flagged, news recall 60% → 46%).

**Tried and rejected:**
- Training-time augmentation (comma dropping, sentence merging and splitting, word swaps, mimicking humaniser tools): recall fell 83% → 78% and every paraphrase category got worse.
- A word-class pattern feature: no consistent gain.
- A 99.3rd-percentile cut-off: it flagged 0.7% of humans after retraining, exactly as its percentile implies.
- A higher Opus training weight: no gain, more false flags.
- Model-based Mixed detection: no better than the rule version.

### v10: held-out benchmark (`node tests/benchmark.js`, dashboard in `docs/benchmark.html`)
Test half only: 2,339 human and 6,413 AI texts. Split by prompt group (texts written for the same prompt stay together), with Reuters journalists and duplicate learner essays grouped. 610 test documents that were near-copies of training documents were skipped.

| Metric (overall) | v9 | v10 |
|---|---|---|
| Accuracy | 0.657 | **0.868** |
| Precision | 0.997 | **0.999** |
| Recall (AI caught) | 0.533 | **0.820** |
| F1 | 0.695 | **0.901** |
| False-positive rate (humans flagged) | 0.38% (9) | **0.13% (3)** |
| False-negative rate | 0.467 | **0.180** |
| ROC-AUC | 0.907 | **0.993** |
| PR-AUC | 0.969 | **0.998** |
| Calibration error (ECE) | 0.152 | **0.012** |
| Humans landing in "inconclusive" | 2.7% | 4.2% |

| Slice | Recall v9 → v10 | Humans flagged v9 → v10 | ROC-AUC v9 → v10 |
|---|---|---|---|
| Essays: student + university (810 human) | 56% → **85%** | 9 → **1** | 0.963 → 0.994 |
| Stories: Reddit (450 human) | 22% → **62%** | 0 → 2 | 0.844 → 0.968 |
| News: Reuters (132 human) | 5% → **49%** | 0 → 0 | 0.831 → 0.975 |
| English-learner essays (875) | – | 0 → 0 | – |
| AI written with other prompts | 65% → **91%** | | 0.974 → 0.999 |
| Humaniser-tool AI news | 11% → **21%** | 0 → 0 | 0.338 → **0.995** |
| Claude (2023) | 13% → **56%** | | 0.722 → 0.974 |
| **Claude Opus 5.5, held out (24)** | 13% → **29%** | | 0.700 → 0.863 |
| Opus 5.5 edited to sound like a student (15) | 0% → 0% (6 labelled "possibly edited AI") | | |
| Paraphrased / perturbed AI news (7 kinds × 3 strengths) | 16–40% → **50–71%** | 0 → 0 | ~0.92 → ~0.98 |
| Older Claude-written imitations (21) | 48% → 29% | | 0.963 → 0.993 |
| GPTZero comparison set (60 ChatGPT, 63 human) | 8% → 7% | 0 → 0 | 0.540 → 0.904 |

What this means:
- **Humaniser text:** v10 *ranks* it almost perfectly above real news (AUC 0.995), but the cut-offs are set to protect people, so most of it still lands in "inconclusive" rather than "likely AI".
- **Mixed essays** (375 held-out essays with a real AI paragraph pasted in): 10 spotted (v9: 11). The same essays without the AI paragraph were labelled Mixed or AI 5 times (v9: 12).
- **The two flagged Reddit stories** are the only new false positives.

**Limits of this benchmark:**
- Almost all AI test text is from 2023 models (gpt-3.5-turbo, Claude 2).
- Contemporary coverage is 24 held-out Claude Opus 5.5 texts written in this project.
- No GPT-5/6, Gemini, DeepSeek or Llama samples were available (no API access in the build environment). Add them with `tests/data/samples/` and re-run.


### v9: bigger real-world test
The Ghostbuster download was extended to 900 files per group, plus 300 AI news articles run through the "undetectable.ai" humaniser and 149 human / 142 ChatGPT texts from the dataset's GPTZero comparison: **5,303 human and 4,635 AI texts**. Split: files 1–150 and 301–600 for tuning, 151–300 and 601–900 kept back.

v9 changes: in-text citations as a human sign; a single lone AI word counts 40% (one "intricate" in a story, or "underscores" in programming docs, was enough to flag people); weights re-fitted on the bigger set (humans weighted 3×, every clue's direction kept, rhythm weights pinned so stories weren't hurt); Mixed threshold 70 → 72 to match.

| | v8 | v9 |
|---|---|---|
| Humans wrongly flagged, all 5,303 | 33 (0.6%) | **15 (0.3%)** |
| … student essays (894) | 24 | 11 |
| … English learners (2,160) | 6 | 1 |
| … stories, news, docs, GPTZero humans | 1 | 1 |
| Humans flagged, kept-back half (2,590) | 13 | **8** |
| AI caught, all 4,635 | 30.2% | **32.5%** |
| AI caught, kept-back half (2,096) | 32.1% | **34.8%** |
| ChatGPT stories caught | 37% | 47% |
| Humaniser-tool AI news caught | 12% | 14% |
| Humans labelled "Mixed" | 22 | 17 |
| Own corpus / built-in samples / Opus 5.5 | 21 of 53 / 8 of 11 / 8 of 40 | 20 of 53 / 8 of 11 / 8 of 40 |

No human group got more flags, "Mixed" labels or "edited AI" labels than in v8. Your own English essay still scores human-leaning.

### Real-world test (Ghostbuster dataset)
The [Ghostbuster dataset](https://github.com/vivek3141/ghostbuster-data) (Verma et al., 2023, CC BY 3.0) has real human writing and real ChatGPT (gpt-3.5-turbo) and Claude (2023) output written for the same prompts. 2,056 human and 1,800 AI texts were used. Weights were tuned on one half and the other half was only used for checking.

| Kind of text | v5 flagged (cut-off 55) | v4 flagged |
|---|---|---|
| Human: student essays (299) | 6 (2%) | 11 |
| Human: Reddit short stories (300) | 0 | 1 |
| Human: Reuters news (300) | 0 | 0 |
| Human: essays by English learners: ETS/TOEFL, Lang-8, PELIC, BAWE (1,157) | 4 (0.3%) | 7 |
| **All human (2,056)** | **10 (0.5%)** | 19 (0.9%) |
| ChatGPT essays / stories / news (300 each) | 81% / 35% / 7% | 83% / 20% / 7% |
| Claude essays / stories / news (300 each) | 23% / 1% / 3% | 25% / 1% / 3% |
| **All AI (1,800)** | **25.0%** | 23.2% |

On the half kept back for checking: humans wrongly flagged 6 → 3 (of 1,007), AI caught 22.4% → 24.0%.

### Real Claude Opus 5.5 answers (`tests/data/opus55/`)
40 answers written by Claude Opus 5.5 itself in a Claude Code session (explanations, advice, essays, stories, emails, a review, a cover letter, a speech and two "write like a teen" posts), split into 26 for tuning and 14 kept back. Plus 15 "human-refined" versions edited the way a student might (casual words, typos, personal details, structure removed). See `tests/data/opus55/prompts.md`.

| Set | v5 flagged | v6 flagged | v6 average score |
|---|---|---|---|
| Opus 5.5, tuning (26) | 0 | **6** | 32 (v5: 18) |
| Opus 5.5, kept back (14) | 0 | **2** | 28 (v5: 19) |
| Human-refined Opus 5.5 (15) | 0 | 0 (v7: **6 labelled "possibly edited AI"**) | 19 (v7: 29) |

- Every flagged Opus 5.5 answer got **Suspected AI: Claude Opus 5.5**. It never said ChatGPT for these.
- What it catches: structured answers and explanations (vaccines, compound interest, study tips, renewable energy, inflation, Rome).
- What it misses: Opus 5.5 stories, emails, essays and teen-style posts, and anything a person has re-edited. Their habits look like careful human writing.
- Real human texts flagged: unchanged at 10 of 2,056, and still 0 of 216 and 0 of 9 in the other sets.
- **Caveat:** the samples were written knowing they were for this detector, after reading its clue list, and the "human" edits were also written by Opus 5.5. Real Opus 5.5 answers from claude.ai would be a better test.

### Own test set
216 real human passages, collected from text available offline: Python documentation, package READMEs, Go docs, Newton's *Opticks*, the GPL, and classic novels and speeches. Plus 53 AI passages in newer chatbot styles, all written by Claude, with 20 kept back for checking.

| Kind of text | Flagged as AI (cut-off 55) |
|---|---|
| Real human passages (216) | **0%** (4 landed in "inconclusive"; max 45) |
| AI, classic ChatGPT essay style | 100% |
| AI, modern chatbot answers | ~33% |
| AI, short stories | ~25% |
| AI, emails and posts | ~13% |
| AI told to sound like a teenager | ~10% |
| Any text with leftover chatbot lines | nearly always |

v4 caught more of these (47% vs 40% overall), mostly through the "tidy hopeful ending" and "casual but too clean" clues. Those clues were also what wrongly flagged real English learners' essays, so they were narrowed in v5.

### Built-in 20 sample passages (Test lab)
11 AI passages (5 Claude-style, 6 ChatGPT-style) and 9 everyday "human" passages: a teen message, a text to a mate, meeting minutes, a science report, writing by a non-native English speaker, a reflection, a sports recap, a complaint letter and a packing list.
- AI caught: **8 of 11**. Humans wrongly flagged: **0 of 9**.
- Model guess: **8 right, 0 wrong, 3 "can't tell"**.

### Mixed text
**v8 fix, found with a real student's essay.** The old Mixed rule (any ~90-word window scoring 70+ while another scored 35 or less) would have labelled **76 of 2,056 real human texts** "Mixed": 37 of 299 student essays, 34 of 300 university essays, and the student's own English essay. Formal essays naturally have one stretch with "In conclusion" and a few ", evoking…" clauses, and single windows are too jumpy.

The new rule needs one paragraph (not the last, since conclusions naturally read like summaries) to score **70+** (72+ since v9) on its own and sit **40+ points above** the median of the other paragraphs.

| | Old rule | New rule |
|---|---|---|
| Real human texts labelled Mixed | 76 of 2,056 | **6 of 2,262** |
| The student's essay | Mixed | Human-leaning, nothing shaded |
| Real student essays with one real ChatGPT/Claude paragraph pasted in (193) | 49 spotted | 24 spotted |

So it now misses more pasted paragraphs, but it far less often points at a real person's paragraph. The built-in demo (3 human paragraphs + 1 AI paragraph) scores 26 overall, "Mixed", with the AI paragraph shaded (75 vs about 21 for the rest).

### ⚠️ Why these numbers are limited
- **The real chatbot text is from 2023.** Today's ChatGPT and Claude write differently (for example, Claude Opus 5.5 hardly uses em dashes).
- **The newer-style AI text was all written by one AI (Claude).** The "ChatGPT" passages are Claude *imitating* ChatGPT, and the 9 everyday "human" sample passages are Claude imitating people.
- **Some clues were tuned after looking at the 20 sample passages**, so the 8/11 result is in-sample.
- **The model guess was wrong on real 2023 Claude essays**: when it guessed, it said "ChatGPT-leaning", because its Claude clues describe 2026 Claude versions.

A small trained word-frequency model was also tried on the Ghostbuster data. It caught about twice as much 2023 chatbot text with no extra humans flagged, but it didn't help at all on newer-style text and can't explain its decisions clue by clue, so it isn't used.

For comparison, Pangram, a commercial detector that runs a real AI model, reports catching 99.7% of Claude Opus 5.5 answers.

---

## Limitations

- **It misses most plain, edited or "humanised" AI text.** AI imitating a teen with lowercase starts and slang looks human to it.
- **It's unreliable under about 150 words.**
- **v11 still misses most Claude Opus 5.5 text**: 14 of 39 held-out Opus 5.5 texts flagged (36%), and 6 of 15 edited ones (40%).
- **Humaniser tools:** v11 ranks humanised text almost perfectly against real news but only flags about 1 in 4, because the cut-offs protect people.
- **Pasted AI paragraphs** inside human essays are rarely spotted (9 of 375).
- **Trained on 2023 AI text.** New models may write differently. The import folder (`tests/data/samples/`) and `node tests/train.js` let you retrain on new samples.
- **Older notes below about v9 still apply to the rule engine.** Once a person edits them, the best it can do is "Inconclusive: possibly edited AI" (6 of 15), and edited stories and essays usually get through.
- **The edited-AI check can be wrong about casual students.** A real student explaining something in a casual voice, with a story about their family, can trigger it (1 of 2,281 human texts did). That's why it stops at "Inconclusive". The real human test texts include few casual school answers, so the true false-alarm rate for teenagers could be higher.
- **It misses most real chatbot text**: about 3 in 4 in the real-world test, and almost all Claude stories and news.
- **Accuracy on today's chatbots is unknown.** The real chatbot test text is from 2023.
- **The model guess is weak**: right on the imitations, but it never recognised real 2023 Claude text.
- **Clues drift with every model release.** Em dashes are the best example: very common in Opus 5, almost gone in Opus 5.5.
- **English only.** It warns when text doesn't look like English.
- **Style comparison is rough** under 300 words per text, or between different kinds of writing.

---

## Fairness

A 2023 Stanford study (Liang et al.) found commercial GPT detectors wrongly flagged **61%** of TOEFL essays by non-native English writers, because simple vocabulary looks "predictable". This tool:
- doesn't score vocabulary richness or word length
- gives absence-type clues (no names, even rhythm) only small weights
- shows a caution when text is formal, very plain, list-heavy, short, or casual-but-tidy
- treats "Inconclusive" as not flagged
- is tested on 1,157 real essays by English learners (ETS/TOEFL, Lang-8, PELIC, BAWE): 4 flagged (0.3%)

---

## Project structure

```
index.html                 ← the finished detector (generated: don't edit by hand)
build.py                   ← builds index.html from src/
src/
  core.js                  ← rule engine: cleaning, clues, habit score, attribution,
                             sections, sliding window, cautions, style comparison
  stats.js                 ← v10 statistical, structural and semantic feature extractors + genre guess
  ensemble.js              ← v10 assessment: trained model + rule engine + recent-Claude check, confidence, evidence, out-of-distribution
  model.json               ← trained weights (generated by tests/train.js)
  page_template.html       ← page layout, styles and UI code (placeholders /*CORE*/, /*STATS*/, /*ENSEMBLE*/, /*MODEL*/, /*LABSAMPLES*/)
  testlab_samples.txt      ← the 20 built-in Test lab passages
docs/
  technical-assessment.md  ← v9 audit, v10 design and results
  benchmark.html / .json   ← v9 vs v10 benchmark dashboard (generated by tests/benchmark.js)
tests/
  train.js                 ← trains src/model.json (group cross-validation, calibration, genre cut-offs)
  benchmark.js             ← held-out benchmark: all metrics per genre, model family and editing condition, plus attribution accuracy
  lib/gbdt.js              ← small gradient-boosted decision trees with monotone (fairness) constraints
  lib/datasets.js          ← loads every labelled dataset with model / genre / condition / group / split
  lab.js                   ← run Test lab-format files from the command line
  eval_corpus.js           ← score the larger labelled corpus per group
  eval_ghostbuster.js      ← score real human and real ChatGPT/Claude text (Ghostbuster dataset)
  data/
    fetch_ghostbuster.sh   ← downloads the Ghostbuster texts (not committed)
    opus55/                ← 110 real Claude Opus 5.5 texts + 15 "human-refined" versions (Test lab format)
    samples/               ← import your own labelled samples (.jsonl, see its README)
    make_dataset.py        ← assembles tests/data/dataset.json
    build_human.py         ← collects human prose from docs on the machine (not committed)
    extra_human.py         ← public-domain human passages (Austen, Twain, Lincoln…)
    ai_samples.py          ← AI passages used for tuning (written by Claude)
    ai_holdout.py          ← AI passages kept back for checking (written by Claude)
CLAUDE.md                  ← full context for Claude Code sessions working on this repo
```

---

## Development: build, test and tune

Requirements: Python 3 and Node.js. No packages need installing.

```bash
# rebuild the page after editing anything in src/
python3 build.py

# run the 20 sample passages (or your own file) through the engine
node tests/lab.js                         # default file, cut-off 55
node tests/lab.js my_samples.txt 50       # your own file and cut-off

# run the larger corpus
python3 tests/data/make_dataset.py        # once (paths in build_human.py may need adjusting)
node tests/eval_corpus.js

# real human vs real ChatGPT/Claude text (needs git and internet once)
bash tests/data/fetch_ghostbuster.sh
node tests/eval_ghostbuster.js tune       # look at this while changing weights
node tests/eval_ghostbuster.js holdout    # check this at the end

# v10: train the classifier (about 2 minutes) and run the held-out benchmark (about 1 minute)
node tests/train.js            # about 6 minutes: general model, two specialists, attribution model
python3 build.py
node tests/benchmark.js        # writes docs/benchmark.html and docs/benchmark.json

# real Claude Opus 5.5 answers
node tests/lab.js tests/data/opus55/tune.txt
node tests/lab.js tests/data/opus55/holdout.txt          # kept back for checking
node tests/lab.js tests/data/opus55/refined_holdout.txt  # "human-refined" versions
```

### Tuning workflow
1. Collect **real** labelled text: ChatGPT answers, Claude answers, your own writing, and friends' casual writing (with permission).
2. Paste them into the **Test lab** (or save them as a `---`-separated file and run `node tests/lab.js file.txt`).
3. Look at the misses. Which clues fired, and which didn't?
4. Adjust `MODEL.w` (weights), `MODEL.bias` or `BANDS` in `src/core.js`, or add or remove phrases in the lists at the top of that file.
5. Rebuild and re-run `tests/lab.js`, `tests/eval_corpus.js` and `tests/eval_ghostbuster.js`. **Never accept a change that wrongly flags more human text**, especially the English-learner groups.

---

## Version history

| Version | Main changes |
|---|---|
| v1 | First version: five style clues, about 20% of AI text caught, about 4% of human text wrongly flagged |
| v2 | Research-based clues (measured AI words, stock phrases, "not X, it's Y", -ing clauses, chatbot framing, human slips); 0% human text flagged, ~40% of AI caught |
| v3 | Certain giveaways, Markdown and hidden-character checks, section-by-section scan, Compare tab, .txt/.docx upload, English check, copy summary |
| v4 | Text cleaning (hidden characters, look-alike letters, quotes); 2026 evidence (Opus 5.5, GPT-5.x/6); version-aware weights; structure clues (closers, hedging, vague attributions, praise words, colons, specifics, evenness); fiction, email and too-clean-casual clues; Claude vs ChatGPT attribution; inconclusive/mixed bands; sliding window; fairness cautions; Test lab tab |
| v5 | Tested on real data (2,056 human and 1,800 ChatGPT/Claude texts from the Ghostbuster dataset). Fixed clues that wrongly flagged students and English learners ("I hope this helps" as a certain giveaway, "I think" as casual, hopeful endings in essays, lists of -ing words, repeated everyday words). Weights re-fitted (70% hand-set, 30% fitted). Humans flagged 19 → 10, real AI caught 23% → 25%. Added "Introduction:"-style labels and a few measured words. Fixed .docx error message and Test lab model check |
| v6 | Studied 40 real Claude Opus 5.5 answers (v5 caught 0 of them). New "Opus 5.5 answer shape" clue (label-style paragraphs, colon lists, one-sentence openers, "that's why", "the good news is"); "if you paste…, I can…" offers. Opus 5.5 caught 0 → 8 of 40, with no extra humans flagged. New **Suspected AI** line on every result, with a version guess (Claude Opus 5.5, older Claude, ChatGPT GPT-5/6 or GPT-4-style). Single line breaks count as paragraphs when there are no blank lines. "Real Claude Opus 5.5 answer" sample button |
| v7 | **Edited-AI check** for AI text a person has "humanised": casual touches on top of a leftover AI skeleton. New "Inconclusive: possibly edited AI" result (never AI-leaning), its own card, a "Possibly AI that a person has edited" suspected-AI line, and a caution note. Edited Opus 5.5: 0 → 6 of 15 labelled. Humans flagged as AI unchanged (10/2,056, 0/216, 0/9); 1 of 2,281 human texts gets the new inconclusive label |
| v8 | Tested with a real student's English essay (thanks to the owner). It scored 28, "Human-leaning", but the old Mixed rule labelled it "Mixed", and the same rule hit 76 of 2,056 real human texts. **New Mixed rule:** one non-final paragraph 70+ and 40+ above the rest; shading now marks that whole paragraph. Humans labelled Mixed 76 → 6 of 2,262. Scores and AI-leaning results unchanged |
| v9 | Bigger real-data test (5,303 human / 4,635 AI texts, incl. humaniser-tool output). In-text citations as a human sign; lone AI words count 40%; weights re-fitted; Mixed threshold 72. Humans flagged 33 → 15, AI caught 30% → 33%, with no human group getting worse |
| v12.3 | Recent-Claude specialist retrained with 24 more Opus 5.5 texts (36 written, 12 held out); the rest of v12.2 kept (a full retrain flagged more humans and was rejected). Humans flagged 3 → 2, earlier held-out Opus 36% → 49%, edited Opus 40% → 33% |
| v12.2 | Recent-Claude specialist needs ≥50% from the main model on texts under 150 words. Held-out humans flagged 10 → 3 (ASAP school essays 8 → 1), AI caught unchanged |
| v12.1 | No model change. Fixed a test-data bug (token-probability tables loaded as texts; real humaniser recall is 91%, not 28%); added 12,428 ASAP school essays as a test-only fairness check (8 flagged, 0.06%); new import scripts. v13 candidates (neutral essay conventions, ASAP training, bigger retrain) rejected |
| v12 | Hashed character 3-gram features; trained genre classifier for the "type of writing" shown; stricter cut-offs (99.9th percentile); a reformatted-human-text robustness test in the benchmark. Held-out humans flagged 2 (reformatted versions 3 → 2), humans in "inconclusive" 3.5% → 2.8%, recall 83.3% → 82.3%, sentence-level rewording 53% → 57% |
| v11 | Gradient-boosted trees blended with the logistic ensemble; trained Claude-vs-ChatGPT attribution (right 88–99% of the time when it names a model, vs 2–28% for the old clues); humaniser specialist; specialists need ≥5% support from the main model; "likely human" below 50; version hints from the recent-Claude model; 40 more Opus 5.5 samples. Held-out: humans flagged 3 → 2, recall 82.0% → 83.3%, Opus 5.5 29% → 36% (on a larger test set), edited Opus 0% → 40% |
| v10 | **Rebuilt detection engine.** Statistical, structural and semantic feature extractors; a trained, calibrated logistic ensemble (7 bootstrap members) with fairness constraints; a recent-Claude specialist; genre-aware cut-offs; length shrinkage, chunked long documents and out-of-distribution checks; confidence and evidence quality; paragraph-by-paragraph model scores. New dataset layer with group splits and a near-duplicate leakage check, paraphrase and perturbation test sets, an import folder for new models, a full benchmark (accuracy, precision, recall, F1, FPR, FNR, ROC-AUC, PR-AUC, ECE) and dashboard, and 30 more Opus 5.5 samples. Held-out: recall 53% → 82%, humans flagged 0.38% → 0.13%, AUC 0.907 → 0.993 |

---

## Sources

- Pangram: [Can Pangram detect Claude Opus 5.5?](https://www.pangram.com/blog/can-pangram-detect-opus-5-5) (Sep 2026): Opus 5.5 vs Opus 5 phrase, structure and sentence changes
- Graphite study via remio: [Claude Opus 5.5 writing tells changed, but they did not disappear](https://www.remio.ai/post/claude-opus-5-5-writing-tells-changed-but-they-did-not-disappear): phrase ratios vs human writing, em-dash rates, GPT-6 comparisons
- Arena analysis via [secnews](https://www.secnews.gr/en/736220/claude-opus-55-ligotera-ichni-ai/): colons and sentence length, Opus 5 vs 5.5
- Sun et al., [Idiosyncrasies in Large Language Models](https://arxiv.org/abs/2502.12150) (ICML 2025): ChatGPT vs Claude word and Markdown fingerprints
- Originality.ai, [Most commonly used ChatGPT words & phrases](https://originality.ai/blog/can-humans-detect-chatgpt): why blog "AI word" lists are unreliable
- Will Keleher, [Your dashes suggest which model you're copy-pasting from](https://will-keleher.com/posts/your-dashes-suggest-which-model-youre-copy-pasting-from/): spaced vs unspaced em dashes
- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
- Kobak et al., [Delving into ChatGPT usage in academic writing through excess vocabulary](https://arxiv.org/abs/2406.07016)
- Reinhart et al., [Do LLMs write like humans?](https://arxiv.org/abs/2410.16107) (PNAS 2025)
- Liang et al., [GPT detectors are biased against non-native English writers](https://arxiv.org/abs/2304.02819) (2023)
- Verma et al., [Ghostbuster: Detecting text ghostwritten by large language models](https://arxiv.org/abs/2305.15047) (2023) and its [dataset](https://github.com/vivek3141/ghostbuster-data) (CC BY 3.0)
- Hans et al., [Binoculars: zero-shot detection of LLM-generated text](https://arxiv.org/abs/2401.12070)

---

*Built with Claude. The detector, test passages and this README were written in a claude.ai conversation; see `CLAUDE.md` for the full working context.*

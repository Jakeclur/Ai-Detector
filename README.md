# AI Text Detector

A rules-based AI-writing detector that runs entirely in your web browser. Paste some writing (or upload a `.txt` or `.docx` file) and it shows:

- a 0–100 score for how many known AI-writing habits the text has, with a **Human-leaning / Inconclusive / Mixed / AI-leaning** result
- a **Suspected AI** line at the end of every result: "No AI suspected", a model and version guess (e.g. *Claude Opus 5.5*, *older Claude*, *ChatGPT (GPT-5/6)*), or "can't tell"
- **which chatbot it looks more like**, Claude or ChatGPT, with an honest confidence level
- a **bar for every clue**, showing what pushed the score up or down
- **highlights in the text**, so you can see exactly what was flagged and why
- a **section-by-section scan**, and a **Mixed** result that shades one paragraph when it stands out as far more AI-like than the rest

It also has a **Compare** tab, which checks whether a text matches someone's known writing style, and a **Test lab** tab for testing the detector on your own labelled examples.

There is no AI model inside, and nothing you paste is sent anywhere.

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
- an **AI cut-off slider** (35–80), to see the trade-off between catching AI and wrongly flagging people
- **Copy results** (tab-separated), to paste back to Claude for tuning
- **Load 20 sample passages**, the built-in test set

---

## How it works

1. **Clean** the text (see above).
2. **Measure about 25 clues** (listed below). Each one is a rate, such as "per 100 words" or "per sentence", or a yes/no.
3. **Combine** them with a logistic model: `z = bias + Σ weight × min(clue, cap)`, then `p = 1 / (1 + e^-z)`. Caps stop any single clue from dominating.
4. **Shrink short texts** towards 50%: `score = 50 + (p − 50) × (0.5 + 0.5 × confidence)`, where confidence rises from 0 at 40 words to 1 at 300 words.
5. **Band** the score. Any certain giveaway with a score of 45+ forces "AI-leaning". One paragraph standing far above the others forces "Mixed".
6. **Attribute** separately, using Claude and ChatGPT fingerprint clues (see below).

The weights were set by hand from the research, then checked against a labelled test set. Clues based on something being *absent* (few names and numbers, even rhythm) have small weights, so they can never push a text high on their own.

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
- **It misses most Claude Opus 5.5 text**: 8 of 40 real Opus 5.5 answers flagged. Once a person edits them, the best it can do is "Inconclusive: possibly edited AI" (6 of 15), and edited stories and essays usually get through.
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
  core.js                  ← the detection engine: cleaning, clues, scoring, attribution,
                             sections, sliding window, cautions, style comparison
  page_template.html       ← page layout, styles and UI code (placeholders /*CORE*/ and /*LABSAMPLES*/)
  testlab_samples.txt      ← the 20 built-in Test lab passages
tests/
  lab.js                   ← run Test lab-format files from the command line
  eval_corpus.js           ← score the larger labelled corpus per group
  eval_ghostbuster.js      ← score real human and real ChatGPT/Claude text (Ghostbuster dataset)
  data/
    fetch_ghostbuster.sh   ← downloads the Ghostbuster texts (not committed)
    opus55/                ← 40 real Claude Opus 5.5 answers + 15 "human-refined" versions (Test lab format)
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

# AI Text Detector

A rules-based AI-writing detector that runs entirely in your web browser. Paste some writing (or upload a `.txt` or `.docx` file) and it shows:

- a 0–100 score for how many known AI-writing habits the text has, with a **Human-leaning / Inconclusive / Mixed / AI-leaning** result
- **which chatbot it looks more like**, Claude or ChatGPT, with an honest confidence level
- a **bar for every clue**, showing what pushed the score up or down
- **highlights in the text**, so you can see exactly what was flagged and why
- a **section-by-section scan** and **sliding window**, which pick out a pasted AI paragraph inside human writing

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
  | any | **Mixed**, when one stretch of the text scores 65–70+ while another scores 35 or below |

  Short texts are pulled towards the middle, because less text means less evidence.
- **Certain giveaways box:** leftover chatbot lines such as "I hope this helps!", "Would you like me to…", "[Your Name]" or ChatGPT citation codes (`oaicite`, `utm_source=chatgpt.com`).
- **Caution box:** warns when the text is formal, very plain, mostly a list, short, or casual-but-very-tidy, because careful human writing in those styles can look AI-like.
- **Which AI does it look more like?** A Claude ↔ ChatGPT bar with the evidence for each side.
- **Section by section:** each paragraph (or ~110-word chunk) scored on its own.
- **Sliding window:** half-overlapping ~90-word windows. Sentences in a stretch scoring 65+ are shaded in the flagged text.
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
5. **Band** the score. Any certain giveaway with a score of 45+ forces "AI-leaning". A big gap between sections forces "Mixed".
6. **Attribute** separately, using Claude and ChatGPT fingerprint clues (see below).

The weights were set by hand from the research, then checked against a labelled test set. Clues based on something being *absent* (few names and numbers, even rhythm) have small weights, so they can never push a text high on their own.

---

## The clues it uses, and the research behind them

### Pushes the score towards AI

| Clue | What it looks for | Why |
|---|---|---|
| **Certain giveaways** | "As an AI language model", "I hope this helps", "Would you like me to…", "If you want, I can…", "Certainly!", "[Your Name]", ChatGPT citation codes | Text left behind when a chatbot answer is pasted unedited |
| **Measured AI words** | *delve, showcasing, underscores, tapestry, intricate, meticulous, dependable, steady, thoughtful…* | Only words that studies **measured** against human writing: Kobak et al. (15M abstracts), Reinhart et al., and Graphite (Opus 5.5 uses "dependable" 23× the human rate). Blog-list favourites were cut, because Originality.ai found many (e.g. "delve") were rare in real ChatGPT output |
| **Stock phrases** | "plays a crucial role", "it's important to note", "This matters" (116×), "Why X matters" (92×), "Looking ahead" (40×), "adds another layer" (27×), "rather than simply" (32×), "is more than a X, it…" (98×) | Wikipedia's *Signs of AI writing*; Graphite 2026 study of Opus 5.5 |
| **Fiction clichés** | "for a long moment", "said quietly", "felt something shift", "paused", "stared", "in that moment", "weathered hands" | Pangram found these rose sharply in Opus 5.5 stories |
| **Tidy hopeful ending** | Stories that end on "smiled", "for the first time", "hope", "together"… | Pangram: Opus 5.5 stories lean towards hope, resilience and family |
| **Email boilerplate** | "I hope this email finds you well", "I wanted to follow up", "Please don't hesitate to reach out", "Thank you for your time and consideration" | Common AI email openers and closers. Each counts only a little, more when an opener and closer appear together |
| **"Not X, it's Y" contrasts** | "It's not just a tool, it's a movement", "isn't X. It's Y" | Wikipedia's top tell. **Weakened**: Opus 5.5 uses 28% fewer negations than Opus 5 |
| **Chatbot framing** | Sentences opening "The key is", "Here's", "That's why", "Short answer", "In short" | Assistant answer style |
| **Trailing -ing clauses** | ", highlighting its importance" | Reinhart et al.: instruction-tuned AI uses these 2–5× more than people |
| **Formal transitions** | Sentences starting "Moreover", "Furthermore", "Additionally", "Ultimately" | Classic ChatGPT style |
| **Summary closers** | "In short", "In summary", "Overall", "The bottom line" near the end | Pangram: Opus 5.5 summary markers up ~10× and "in short" up 11× vs Opus 5 |
| **Vague attributions** | "experts suggest", "studies show", "it is widely believed" | Wikipedia: AI cites unnamed authorities |
| **Hedging** | "may", "often", "typically", "it depends", "not necessarily" | Small weight. Pangram: caveat markers up 23% in Opus 5.5; GPT-6 overuses "may provide", "not necessarily" |
| **Generic praise words** | "amazing", "valuable", "meaningful", "seamless", "transformative" | Promotional tone |
| **Bullets, headings, bold** | Markdown density | Small weight, because human notes and docs use them too |
| **Colons** | Colons introducing a point | Very small weight. Opus 5 used 6.1 per 1,000 words, Opus 5.5 only 1.6 |
| **Rule of three** | "A, B, and C" lists | Small weight |
| **Em dashes** | — | **Very small and version-dependent**: Opus 5 used about 3–13 per 1,000 words, Opus 5.5 almost none, and GPT-5 still often uses them. Mainly used to guess the model (see below) |
| **Few concrete specifics** | Few names, numbers or quotes per 100 words | Absence clue, very small weight |
| **Overly even tone** | Very uniform sentence and paragraph lengths, with no ! or ? | Pangram: Opus 5.5 sentences are shorter and more uniform (spread 0.53 → 0.48) |
| **Casual but too clean** | Sounds casual ("honestly", "kind of") but has no slips at all, even rhythm and a generic or moral ending | Targets AI told to "write like a teen". Moderate weight, and shows its own caution note |
| **Neat moral ending** | Last sentence like "It's all about balance" or "That's what matters most" | Stock wrap-up |

### Pulls the score towards human
| Clue | What it looks for |
|---|---|
| **Human slips** | Missing apostrophes ("dont", "im"), lowercase "i", lowercase sentence starts, slang ("lol", "ngl", "tbh"), "!!", double spaces, no full stop at the end |
| **Sentence rhythm** | Very uneven sentence lengths, including very short (≤3 words) or very long (≥45 words) ones |

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

### Main test set
216 real human passages, collected from text available offline: Python documentation, package READMEs, Go docs, Newton's *Opticks*, the GPL, and classic novels and speeches. Plus 53 AI passages in five styles, all written by Claude, with 20 kept back for checking.

| Kind of text | Flagged as AI (cut-off 55) |
|---|---|
| Real human passages (216) | **0%** (9, about 4%, landed in "inconclusive") |
| AI, classic ChatGPT essay style | 100% |
| AI, modern chatbot answers | ~55% |
| AI, short stories | ~40% |
| AI, emails and posts | ~15% |
| AI told to sound like a teenager | ~10% |
| Any text with leftover chatbot lines | nearly always |

### Built-in 20 sample passages (Test lab)
11 AI passages (5 Claude-style, 6 ChatGPT-style) and 9 everyday "human" passages: a teen message, a text to a mate, meeting minutes, a science report, writing by a non-native English speaker, a reflection, a sports recap, a complaint letter and a packing list.
- AI caught: **8 of 11**. Humans wrongly flagged: **0 of 9**.
- Model guess: **8 right, 0 wrong, 3 "can't tell"**.

### Mixed text
An essay made of 3 human paragraphs plus 1 pasted AI paragraph scored **25** overall and was labelled **"Mixed"**. The AI paragraph's section scored **67**, and the sliding window reached **76**. No stretch of human text in the test set scored above 39.

### ⚠️ Why these numbers are optimistic
- **All AI text was written by one AI (Claude).** The "ChatGPT" passages are Claude *imitating* ChatGPT, not real ChatGPT output.
- **The 9 everyday "human" sample passages were also written by Claude**, imitating people.
- **Some clues were tuned after looking at the 20 sample passages**, so the 8/11 result is in-sample.
- **The real human texts are mostly formal or old.** There's no genuine teenage or casual writing.

For comparison, Pangram, a commercial detector that runs a real AI model, reports catching 99.7% of Claude Opus 5.5 answers.

---

## Limitations

- **It misses most plain, edited or "humanised" AI text.** AI imitating a teen with lowercase starts and slang looks human to it.
- **It's unreliable under about 150 words.**
- **Real accuracy is unknown** until it's tested on real ChatGPT/Claude output and real casual human writing.
- **The model guess is new**, and only checked on 11 imitations.
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
  data/
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
```

### Tuning workflow
1. Collect **real** labelled text: ChatGPT answers, Claude answers, your own writing, and friends' casual writing (with permission).
2. Paste them into the **Test lab** (or save them as a `---`-separated file and run `node tests/lab.js file.txt`).
3. Look at the misses. Which clues fired, and which didn't?
4. Adjust `MODEL.w` (weights), `MODEL.bias` or `BANDS` in `src/core.js`, or add or remove phrases in the lists at the top of that file.
5. Rebuild and re-run. **Never accept a change that wrongly flags more human text.** Check the human max score stays well below 55.

---

## Version history

| Version | Main changes |
|---|---|
| v1 | First version: five style clues, about 20% of AI text caught, about 4% of human text wrongly flagged |
| v2 | Research-based clues (measured AI words, stock phrases, "not X, it's Y", -ing clauses, chatbot framing, human slips); 0% human text flagged, ~40% of AI caught |
| v3 | Certain giveaways, Markdown and hidden-character checks, section-by-section scan, Compare tab, .txt/.docx upload, English check, copy summary |
| v4 | Text cleaning (hidden characters, look-alike letters, quotes); 2026 evidence (Opus 5.5, GPT-5.x/6); version-aware weights; structure clues (closers, hedging, vague attributions, praise words, colons, specifics, evenness); fiction, email and too-clean-casual clues; Claude vs ChatGPT attribution; inconclusive/mixed bands; sliding window; fairness cautions; Test lab tab |

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
- Hans et al., [Binoculars: zero-shot detection of LLM-generated text](https://arxiv.org/abs/2401.12070)

---

*Built with Claude. The detector, test passages and this README were written in a claude.ai conversation; see `CLAUDE.md` for the full working context.*

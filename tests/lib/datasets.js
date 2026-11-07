// Dataset layer for training and benchmarking.
//
// Every document is { text, label, model, genre, condition, source, group, split }:
//   label      "human" | "ai"
//   model      e.g. "human", "gpt-3.5-turbo", "claude-2023", "claude-opus-5.5", "gpt-3.5+humaniser"
//   genre      "academic" | "creative" | "news" | "explanation" | "conversational" | "learner" | "docs" | "other"
//   condition  "original" | "prompt-variant" | "humaniser" | "word-synonyms" | "word-edits" | "char-noise"
//              | "sentence-paraphrase" | "paragraph-paraphrase" | "sentence-edits" | "paragraph-edits"
//              | "human-edited-simulated"
//   group      documents that share a prompt or a source text share a group, so they always land in the
//              same split (no leakage between training and testing)
//   split      "train" | "test" (test is never used for fitting)
//   half       test documents only: "dev" (all decisions) or "final" (sealed; scored only by benchmark.js --final)
//
// Sources:
//   - Ghostbuster (Verma et al. 2023, CC BY 3.0), downloaded by tests/data/fetch_ghostbuster.sh
//   - this repo's corpus (tests/data/dataset.json, built by tests/data/make_dataset.py)
//   - tests/data/opus55/*.txt  (real Claude Opus 5.5 output, see prompts.md)
//   - tests/data/samples/*.jsonl  (import your own: one JSON object per line, fields as above;
//     label and text are required, the rest default sensibly; see tests/data/samples/README.md)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = path.join(__dirname, "../data");
const GB = process.env.GHOSTBUSTER_DIR || path.join(DATA, "ghostbuster");

function walk(d) {
  if (!fs.existsSync(d)) return [];
  // only real texts: numbered .txt files. Ghostbuster also ships per-token probability tables ("12-ada.txt",
  // "logprobs/" folders); before v13 these were wrongly loaded as texts in the humaniser and GPTZero sets.
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? (f.name === "logprobs" ? [] : walk(path.join(d, f.name))) : /^[0-9]+\.txt$/.test(f.name) ? [path.join(d, f.name)] : []);
}
const read = f => fs.readFileSync(f, "utf8");
const num = f => parseInt(path.basename(f), 10);
// v9 split, kept so results stay comparable: prompts 1-150 and 301-600 train, the rest test
// v13: prompts above 900 (the extra download) split 60/40 by prompt number
const ghostSplit = n => n > 900 ? (n % 5 < 3 ? "train" : "test") : (n <= 150 || (n >= 301 && n <= 600)) ? "train" : "test";
// for sources without prompt numbers: a stable hash of the group id (about 60/40)
const hashSplit = g => (parseInt(crypto.createHash("md5").update(g).digest("hex").slice(0, 8), 16) % 10) < 6 ? "train" : "test";

function ghostbuster() {
  const out = [];
  const DOM = { essay: "academic", wp: "creative", reuter: "news" };
  const MODEL = { human: "human", gpt: "gpt-3.5-turbo", claude: "claude-2023", gpt_prompt1: "gpt-3.5-turbo", gpt_prompt2: "gpt-3.5-turbo", gpt_writing: "gpt-3.5-turbo", gpt_semantic: "gpt-3.5-turbo" };
  for (const dom of ["essay", "wp", "reuter"]) for (const src of Object.keys(MODEL)) {
    for (const f of walk(path.join(GB, dom, src))) {
      const n = num(f);
      // news files are reuter/<src>/<author>/<n>.txt: the author+number pair is the prompt
      const author = dom === "reuter" ? path.basename(path.dirname(f)) : "";
      // Reuters journalists reuse whole paragraphs across articles, so a journalist is one group
      const group = dom === "reuter" ? `reuter:${author}` : `${dom}:${n}`;
      const split = dom === "reuter" ? hashSplit(group) : ghostSplit(n);
      out.push({ text: read(f), label: src === "human" ? "human" : "ai", model: MODEL[src], genre: DOM[dom],
        condition: src.startsWith("gpt_") ? "prompt-variant" : "original", source: `ghostbuster/${dom}/${src}`, group, split, fileNo: n });
    }
  }
  const LEARN = ["ets", "lang8", "pelic", "toefl91", "bawe"];
  for (const s of LEARN) for (const f of walk(path.join(GB, "other", s))) {
    // learner corpora contain exact duplicates under different numbers: group by content
    const text = read(f), group = `${s}:` + crypto.createHash("md5").update(text.replace(/\s+/g, " ").trim().slice(0, 400)).digest("hex").slice(0, 10);
    out.push({ text, label: "human", model: "human", genre: s === "bawe" ? "academic" : "learner", condition: "original",
      source: `ghostbuster/other/${s}`, group, split: hashSplit(group), fileNo: num(f) });
  }
  for (const f of walk(path.join(GB, "other", "gptzero"))) {
    const lab = f.includes(`${path.sep}gpt${path.sep}`) ? "ai" : "human";
    out.push({ text: read(f), label: lab, model: lab === "ai" ? "chatgpt-unknown" : "human", genre: "explanation", condition: "original",
      source: `ghostbuster/other/gptzero/${lab === "ai" ? "gpt" : "human"}`, group: `gptzero:${num(f)}`, split: hashSplit(`gptzero:${num(f)}`) });
  }
  for (const f of walk(path.join(GB, "other", "undetectable"))) {
    out.push({ text: read(f), label: "ai", model: "gpt-3.5+humaniser", genre: "news", condition: "humaniser",
      source: "ghostbuster/other/undetectable", group: `undetectable:${path.relative(path.join(GB, "other", "undetectable"), f)}`, split: hashSplit(f) });
  }
  // perturbations of 200 Ghostbuster documents (label file: 1 = AI). Test only: origins unknown.
  const labF = path.join(GB, "perturb", "labels.txt");
  if (fs.existsSync(labF)) {
    const labels = read(labF).trim().split(/\s+/).map(Number);
    const COND = { char_basic: "char-noise", word_syn: "word-synonyms", word_adj: "word-edits", sent_paraph: "sentence-paraphrase", para_paraph: "paragraph-paraphrase", sent_adj: "sentence-edits", para_adj: "paragraph-edits" };
    for (const [t, cond] of Object.entries(COND)) for (const f of walk(path.join(GB, "perturb", t))) {
      const level = path.basename(path.dirname(f)), i = num(f);
      if (labels[i] === undefined) continue;
      out.push({ text: read(f), label: labels[i] ? "ai" : "human", model: labels[i] ? "gpt-3.5-turbo" : "human", genre: "news", condition: `${cond}@${level}`,
        source: `ghostbuster/perturb/${t}/${level}`, group: `perturb:${i}`, split: "test" });
    }
  }
  return out;
}

function repoCorpus() {
  const f = path.join(DATA, "dataset.json");
  if (!fs.existsSync(f)) return [];
  const d = JSON.parse(read(f));
  const out = [];
  for (const o of d.human) out.push({ text: o.text, label: "human", model: "human", genre: o.source.startsWith("pd:") ? "other" : "docs", condition: "original", source: "repo/" + o.source.split(":")[0], group: "repo:" + o.source + ":" + crypto.createHash("md5").update(o.text).digest("hex").slice(0, 6), split: "train" });
  for (const [arr, split] of [[d.ai, "train"], [d.ai_holdout || [], "test"]]) for (const o of arr) {
    const style = o.source.split(":")[1];
    out.push({ text: o.text, label: "ai", model: "claude-imitation", genre: style === "creative" ? "creative" : style === "email" ? "conversational" : style === "humanized" ? "conversational" : "explanation",
      condition: style === "humanized" ? "prompt-variant" : "original", source: `repo/ai-${style}`, group: "repo:" + o.source + ":" + crypto.createHash("md5").update(o.text).digest("hex").slice(0, 6), split });
  }
  return out;
}

function labFile(f) {
  return read(f).replace(/\r\n?/g, "\n").trim().split(/\n\s*-{3,}\s*\n/).map(b => { const l = b.trim().split("\n"); return { label: l[0].trim(), text: l.slice(1).join("\n") }; });
}

// Opus 5.5: the genre of each prompt (same order as prompts.md)
const OPUS_TUNE_GENRE = ["explanation", "explanation", "explanation", "explanation", "explanation", "explanation", "explanation", "academic", "academic", "academic", "academic", "creative", "creative", "creative", "conversational", "conversational", "explanation", "news", "creative", "explanation", "creative", "conversational", "conversational", "conversational", "explanation", "explanation"];
const OPUS_HOLD_GENRE = ["explanation", "explanation", "explanation", "academic", "academic", "creative", "conversational", "conversational", "academic", "explanation", "conversational", "explanation", "academic", "academic"];
function opus55() {
  const dir = path.join(DATA, "opus55"), out = [];
  if (!fs.existsSync(dir)) return out;
  labFile(path.join(dir, "tune.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: OPUS_TUNE_GENRE[i] || "other", condition: "original", source: "opus55/tune", group: `opus:t${i}`, split: "train" }));
  labFile(path.join(dir, "holdout.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: OPUS_HOLD_GENRE[i] || "other", condition: "original", source: "opus55/holdout", group: `opus:h${i}`, split: "test" }));
  // second batch (v10): stories, news, essays, emails, technical writing
  const XT = ["creative", "creative", "creative", "creative", "creative", "news", "news", "news", "academic", "academic", "academic", "conversational", "conversational", "conversational", "conversational", "explanation", "academic", "explanation", "other", "other"];
  const XH = ["creative", "creative", "creative", "news", "news", "academic", "academic", "conversational", "explanation", "academic"];
  if (fs.existsSync(path.join(dir, "extra_tune.txt"))) labFile(path.join(dir, "extra_tune.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: XT[i] || "other", condition: "original", source: "opus55/extra_tune", group: `opus:xt${i}`, split: "train" }));
  if (fs.existsSync(path.join(dir, "extra_holdout.txt"))) labFile(path.join(dir, "extra_holdout.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: XH[i] || "other", condition: "original", source: "opus55/extra_holdout", group: `opus:xh${i}`, split: "test" }));
  // third batch (v11)
  const B3T = ["creative", "creative", "creative", "creative", "creative", "news", "news", "news", "academic", "academic", "academic", "conversational", "conversational", "conversational", "conversational", "explanation", "explanation", "academic", "other", "other", "conversational", "explanation", "explanation", "academic", "other"];
  const B3H = ["creative", "creative", "creative", "news", "news", "academic", "academic", "conversational", "explanation", "academic", "explanation", "conversational", "conversational", "explanation", "other"];
  if (fs.existsSync(path.join(dir, "batch3_tune.txt"))) labFile(path.join(dir, "batch3_tune.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: B3T[i] || "other", condition: "original", source: "opus55/batch3_tune", group: `opus:b3t${i}`, split: "train" }));
  if (fs.existsSync(path.join(dir, "batch3_holdout.txt"))) labFile(path.join(dir, "batch3_holdout.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: B3H[i] || "other", condition: "original", source: "opus55/batch3_holdout", group: `opus:b3h${i}`, split: "test" }));
  // fourth batch (v12.3): advice, reviews, tips, reflections, plus stories, emails, explanations, essays and news
  const B4T = ["creative", "creative", "creative", "creative", "news", "news", "academic", "academic", "academic", "conversational", "conversational", "conversational", "explanation", "explanation", "explanation", "other", "other", "other", "other", "other", "other", "explanation", "explanation", "other"];
  const B4H = ["creative", "creative", "news", "academic", "conversational", "explanation", "explanation", "other", "other", "other", "explanation", "other"];
  if (fs.existsSync(path.join(dir, "batch4_tune.txt"))) labFile(path.join(dir, "batch4_tune.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: B4T[i] || "other", condition: "original", source: "opus55/batch4_tune", group: `opus:b4t${i}`, split: "train" }));
  if (fs.existsSync(path.join(dir, "batch4_holdout.txt"))) labFile(path.join(dir, "batch4_holdout.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: B4H[i] || "other", condition: "original", source: "opus55/batch4_holdout", group: `opus:b4h${i}`, split: "test" }));
  // fifth batch: written for a v12.4 specialist retrain, which flagged more humans (2 -> 4) and was rejected; kept as test-only data
  const B5T = ["creative", "creative", "conversational", "conversational", "explanation", "other", "academic", "conversational", "explanation", "other", "conversational", "other", "other", "explanation", "conversational", "explanation", "news", "other", "conversational", "explanation", "other", "other", "explanation"];
  if (fs.existsSync(path.join(dir, "batch5_test.txt"))) labFile(path.join(dir, "batch5_test.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: B5T[i] || "other", condition: "original", source: "opus55/batch5_test", group: `opus:b5t${i}`, split: "test" }));
  // refined versions share the group of their original (tune passages 2,5,7,8,11,13,16,19 / hold-out 3,12,15,18,30,36,40)
  const RT = [1, 3, 4, 5, 7, 8, 10, 12], RH = [0, 3, 4, 5, 9, 11, 13];
  labFile(path.join(dir, "refined_tune.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: OPUS_TUNE_GENRE[RT[i]] || "other", condition: "human-edited-simulated", source: "opus55/refined_tune", group: `opus:t${RT[i]}`, split: "test" }));
  labFile(path.join(dir, "refined_holdout.txt")).forEach((o, i) => out.push({ text: o.text, label: "ai", model: "claude-opus-5.5", genre: OPUS_HOLD_GENRE[RH[i]] || "other", condition: "human-edited-simulated", source: "opus55/refined_holdout", group: `opus:h${RH[i]}`, split: "test" }));
  return out;
}

function labSamples() {
  return labFile(path.join(__dirname, "../../src/testlab_samples.txt")).map((o, i) => {
    const lab = /human/i.test(o.label) ? "human" : "ai";
    return { text: o.text, label: lab, model: lab === "human" ? "human" : /claude/i.test(o.label) ? "claude-imitation" : "chatgpt-imitation", genre: "other", condition: "original", source: "repo/testlab", group: `lab:${i}`, split: "test" };
  });
}

// v14: independent Claude texts written by separate Opus / Sonnet / Haiku helper sessions that saw only plain writing
// requests (no detector context). tests/data/claude_indep/*.jsonl, one row per response:
// { text, model, prompt, genre, length }. Split by request (all three models' answers to a request stay together):
// about half train, the rest test (then sealed into dev/final like every other test document).
function claudeIndep() {
  const dir = path.join(DATA, "claude_indep"), out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".jsonl")).sort()) {
    read(path.join(dir, f)).split("\n").forEach(line => {
      if (!line.trim()) return;
      const o = JSON.parse(line), group = `cindep:p${o.prompt}`;
      const h = parseInt(crypto.createHash("md5").update(group + "|v14").digest("hex").slice(0, 8), 16) % 100;
      out.push({ text: o.text, label: "ai", model: o.model, genre: o.genre || "other", condition: o.condition || "original",
        source: `claude_indep/${o.model}`, group, split: h < 50 ? "train" : "test", length: o.length, prompt: o.prompt });
    });
  }
  return out;
}

// v14: DetectRL (Wu et al. 2024) test files, tests/data/external/detectrl (fetch_external.sh). Test-only: no licence file,
// so never trained on. Duplicated texts across files are kept once.
function detectrl() {
  const dir = path.join(DATA, "external", "detectrl"), out = [];
  if (!fs.existsSync(dir)) return out;
  const DOM = { abstract: "academic", document: "news", story: "creative", content: "other" };
  const MOD = { ChatGPT: "gpt-3.5-turbo", "Google-PaLM": "palm-2", "Claude-instant": "claude-instant", "Llama-2-70b": "llama-2-70b" };
  const seen = new Set();
  const files = fs.readdirSync(dir).filter(n => n.endsWith(".json")).sort();
  for (const f of files) {
    const mixHuman = /human_centered_mixing/.test(f), mixLlm = /llm_centered_mixing/.test(f), polishHuman = /paraphrase_polish_human/.test(f);
    if (/multi_(human|llm)_mixing|data_mixing_attacks/.test(f)) continue;
    for (const e of JSON.parse(read(path.join(dir, f)))) {
      const text = (e.text || "").trim(); if (!text) continue;
      const k = crypto.createHash("md5").update(text).digest("hex"); if (seen.has(k)) continue; seen.add(k);
      let label = e.label === "llm" ? "ai" : "human", condition = "original";
      if (label === "ai") {
        if (mixHuman) condition = "mixed-sentences-mostly-human";
        else if (mixLlm) condition = "mixed-sentences-mostly-ai";
        else if (e.data_type !== "direct_prompt") condition = "drl-" + e.data_type.replace(/_llm$/, "");
      } else if (polishHuman) { condition = "ai-polished-human"; }
      else if (/adversarial_/.test(e.data_type)) condition = "drl-" + e.data_type.replace(/_human$/, "");
      out.push({ text, label, model: label === "human" ? "human" : (MOD[e.llm_type] || e.llm_type), genre: DOM[e.data_type] || "other", condition,
        source: `detectrl/${label === "human" ? "human" : MOD[e.llm_type] || e.llm_type}`, group: "drl:" + k.slice(0, 12), split: "test" });
    }
  }
  return out;
}

// v14 sealed test split. Every test document is assigned once, by a hash of its group, to "dev" (used for every
// decision: feature choice, thresholds, accept/reject) or "final" (only scored by tests/benchmark.js --final, which
// logs each run in docs/final-runs.md). Groups never straddle the two halves.
const sealSplit = g => (parseInt(crypto.createHash("md5").update(g + "|v14-seal").digest("hex").slice(0, 8), 16) % 2) ? "final" : "dev";

// your own samples: tests/data/samples/*.jsonl
function imported() {
  const dir = path.join(DATA, "samples"), out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".jsonl"))) {
    read(path.join(dir, f)).split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      const o = JSON.parse(line);
      if (!o.text || !/^(human|ai)$/.test(o.label)) throw new Error(`${f}:${i + 1}: needs "text" and label "human" or "ai"`);
      const group = o.group || `${f}:${i}`;
      out.push({ text: o.text, label: o.label, model: o.model || (o.label === "human" ? "human" : "unknown-ai"), genre: o.genre || "other", condition: o.condition || "original",
        source: o.source || `samples/${f}`, group, split: o.split || hashSplit(group) });
    });
  }
  return out;
}

let cache = null;
function all() {
  if (cache) return cache;
  cache = [...ghostbuster(), ...repoCorpus(), ...opus55(), ...labSamples(), ...imported(), ...claudeIndep(), ...detectrl()].filter(d => d.text && d.text.trim());
  cache.forEach((d, i) => { d.key = i; if (d.split === "test") { d.half = sealSplit(d.group); } });
  return cache;
}

// Mark test docs that are near-copies of training docs (leak: true). Benchmarks skip them.
function markLeaks(docs) {
  const leaks = new Set(leakageReport(docs).map(h => h.key));
  for (const d of docs) d.leak = leaks.has(d.key);
  return leaks.size;
}

// Near-duplicate check: 8-word shingles. Returns test docs that share >30% of shingles with any train doc
// from a different group (possible leakage).
function leakageReport(docs) {
  const sh = t => { const w = t.toLowerCase().match(/[a-z0-9']+/g) || []; const s = new Set(); for (let i = 0; i + 8 <= w.length; i += 2) s.add(w.slice(i, i + 8).join(" ")); return s; };
  const index = new Map();
  for (const d of docs) if (d.split === "train") for (const s of sh(d.text)) { if (!index.has(s)) index.set(s, new Set()); index.get(s).add(d.group); }
  const hits = [];
  for (const d of docs) if (d.split === "test") {
    const S = sh(d.text); if (!S.size) continue;
    const cnt = new Map();
    for (const s of S) for (const g of index.get(s) || []) if (g !== d.group) cnt.set(g, (cnt.get(g) || 0) + 1);
    for (const [g, c] of cnt) if (c / S.size > 0.3) { hits.push({ key: d.key, source: d.source, group: d.group, overlapsWith: g, share: +(c / S.size).toFixed(2) }); break; }
  }
  return hits;
}

module.exports = { markLeaks, all, ghostbuster, repoCorpus, opus55, labSamples, imported, leakageReport, claudeIndep, detectrl, sealSplit };

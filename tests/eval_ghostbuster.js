// Score real human and real chatbot text from the Ghostbuster dataset (Verma et al., 2023, CC BY 3.0).
//   bash tests/data/fetch_ghostbuster.sh        (once: downloads ~5,000 small text files, not committed)
//   node tests/eval_ghostbuster.js [tune|holdout|all] [cutoff]
//
// Groups:
//   human  - student essays (IvyPanda), Reddit WritingPrompts stories, Reuters news,
//            and essays by English learners (ETS/TOEFL, Lang-8, PELIC, BAWE).
//   ai     - ChatGPT (gpt-3.5-turbo) and Claude (2023 versions) answering the same prompts.
// Files numbered 1-150 and 301-600 (news: 1-3 per author) are the "tune" part; 151-300 and 601-900 are "holdout".
// Change weights only while looking at "tune", then check "holdout" once.
const path = require("path");
const fs = require("fs");
const E = require(path.join(__dirname, "../src/core.js"));

const root = process.env.GHOSTBUSTER_DIR || path.join(__dirname, "data/ghostbuster");
if (!fs.existsSync(root)) { console.error(`${root} not found. Run: bash tests/data/fetch_ghostbuster.sh`); process.exit(1); }
const split = process.argv[2] || "all";
const cut = +(process.argv[3] || E.BANDS.ai);
const GROUPS = [
  ["human", "essay/human"], ["human", "wp/human"], ["human", "reuter/human"],
  ["human", "other/ets"], ["human", "other/lang8"], ["human", "other/pelic"], ["human", "other/toefl91"], ["human", "other/bawe"], ["human", "other/gptzero/human"],
  ["ai", "essay/gpt"], ["ai", "essay/claude"], ["ai", "wp/gpt"], ["ai", "wp/claude"], ["ai", "reuter/gpt"], ["ai", "reuter/claude"],
  ["ai", "other/gptzero/gpt"], ["ai", "other/undetectable"]   // undetectable = AI news run through a "humaniser" tool
];
function files(dir) {
  const out = [];
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith(".txt")) out.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}
function inSplit(file, group) {
  if (split === "all") return true;
  const n = parseInt(path.basename(file), 10);
  const tune = group.startsWith("reuter/") ? n <= 3 : n <= 150 || (n >= 301 && n <= 600);
  return split === "tune" ? tune : !tune;
}
const res = { human: [], ai: [] }, worst = [];
const verbose = process.env.VERBOSE;
console.log("group              n  mean  inconcl  flagged   max   model guess for flagged texts (claude / chatgpt / unclear)   suspected AI");
for (const [kind, g] of GROUPS) {
  const scores = []; const lean = { claude: 0, chatgpt: 0, unclear: 0 }; const sus = {};
  for (const f of files(path.join(root, g))) {
    if (!inSplit(f, g)) continue;
    const text = E.cleanText(fs.readFileSync(f, "utf8")).text;
    const r = E.analyze(text);
    if (r.tooShort) continue;
    scores.push(r.score);
    if (kind === "ai" && r.band === "edited") sus["edited AI?"] = (sus["edited AI?"] || 0) + 1;
    if (kind === "ai" && r.score >= cut) { const a = E.attribute(text, r); lean[a.lean]++; const v = E.suspect(text, r, a).short; sus[v] = (sus[v] || 0) + 1; }
    if (kind === "human" && r.score >= 45) worst.push([r.score, path.relative(root, f)]);
    if (verbose && kind === "ai" && r.score < 35) console.log("  missed", r.score, path.relative(root, f));
  }
  if (!scores.length) { console.log(g.padEnd(16), "  (no files)"); continue; }
  res[kind].push(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const pct = x => (x / scores.length * 100).toFixed(0).padStart(4) + "%";
  console.log(g.padEnd(16), String(scores.length).padStart(4), mean.toFixed(0).padStart(5), pct(scores.filter(s => s >= E.BANDS.human && s < cut).length).padStart(8),
    pct(scores.filter(s => s >= cut).length).padStart(8), String(Math.max(...scores)).padStart(5), kind === "ai" ? `   ${lean.claude} / ${lean.chatgpt} / ${lean.unclear}   ${Object.entries(sus).map(([k, v]) => k + ": " + v).join(", ")}` : "");
}
const H = res.human, A = res.ai;
console.log(`\n[${split}] cut-off ${cut}: humans wrongly flagged ${H.filter(s => s >= cut).length}/${H.length} (${(H.filter(s => s >= cut).length / H.length * 100).toFixed(1)}%), ` +
  `AI caught ${A.filter(s => s >= cut).length}/${A.length} (${(A.filter(s => s >= cut).length / A.length * 100).toFixed(1)}%)`);
worst.sort((a, b) => b[0] - a[0]);
if (worst.length) console.log("highest-scoring human texts:", worst.slice(0, 12).map(w => w.join(" ")).join(", "));

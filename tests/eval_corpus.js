// Score the larger labelled corpus and print results per group.
//   python3 tests/data/make_dataset.py   (once, to build tests/data/dataset.json)
//   node tests/eval_corpus.js [cutoff]
// The human part of the corpus is rebuilt from text on your own machine (see build_human.py),
// so it is not committed to the repo.
const path = require("path");
const fs = require("fs");
const E = require(path.join(__dirname, "../src/core.js"));
const dsPath = path.join(__dirname, "data/dataset.json");
if (!fs.existsSync(dsPath)) { console.error("tests/data/dataset.json not found. Run: python3 tests/data/make_dataset.py"); process.exit(1); }
const d = JSON.parse(fs.readFileSync(dsPath, "utf8"));
const thr = +(process.argv[2] || E.BANDS.ai);
const g = {}, high = [];
for (const [key, arr] of [["human", d.human], ["ai", d.ai], ["ai-holdout", d.ai_holdout || []]]) for (const o of arr) {
  const r = E.analyze(E.cleanText(o.text).text);
  if (r.tooShort) continue;
  const grp = key === "human" ? "human:" + o.source.split(":")[0] : key + ":" + o.source.split(":")[1];
  (g[grp] = g[grp] || []).push(r.score);
  if (key === "human" && r.score >= 45) high.push([o.source, r.score]);
}
const H = [], A = [];
for (const [k, v] of Object.entries(g)) {
  (k.startsWith("human") ? H : A).push(...v);
  console.log(k.padEnd(26), "n", String(v.length).padStart(3), " mean", (v.reduce((a, b) => a + b, 0) / v.length).toFixed(0).padStart(3), " flagged", (v.filter(x => x >= thr).length / v.length * 100).toFixed(0).padStart(3) + "%", " max", Math.max(...v));
}
console.log(`\ncut-off ${thr}: human FPR ${(H.filter(x => x >= thr).length / H.length * 100).toFixed(1)}%  AI TPR ${(A.filter(x => x >= thr).length / A.length * 100).toFixed(1)}%  humans in inconclusive band ${H.filter(x => x >= E.BANDS.human && x < thr).length}`);
if (high.length) console.log("human passages scoring 45+:", high);

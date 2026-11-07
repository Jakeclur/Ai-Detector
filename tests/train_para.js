// Train the v14 paragraph-level AI classifier (model.json `paraModel`). The general model was trained on whole
// documents and is unreliable on single paragraphs; this one is trained on paragraphs (30-320 words) of training
// documents from cross-fit fold A only, so the mixed-authorship model can be trained on fold B with realistic scores
// from the very same classifier that runs in the browser.
//   [DRL_TRAIN=1] node tests/train_para.js [--out=path]
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const T = require("./train.js");
const D = require("./lib/datasets.js");
const { paras } = require("./lib/mixed.js");
const args = process.argv.slice(2);
const OUT = (args.find(a => a.startsWith("--out=")) || "").split("=")[1] || path.join(__dirname, "../src/model.json");
const foldOf = g => (parseInt(crypto.createHash("md5").update(g + "|crossfit").digest("hex").slice(0, 8), 16) % 2) ? "B" : "A";
const nw = t => (t.match(/\S+/g) || []).length;
const t0 = Date.now();
const docs = D.all(); D.markLeaks(docs);
const rows = [];
for (const d of docs) {
  if (d.split !== "train" || (!args.includes("--all") && foldOf(d.group) !== "A")) continue;
  if (!(d.condition === "original" || d.condition === "prompt-variant" || d.condition === "humaniser")) continue;
  // up to 3 paragraphs per document, prose only
  const ps = paras(d.text).filter(p => { const w = nw(p); return w >= 30 && w <= 320 && !/^(#|[-*•]|\d+[.)])/.test(p); });
  const pick = ps.length <= 3 ? ps : [ps[0], ps[Math.floor(ps.length / 2)], ps[ps.length - 1]];
  // single-paragraph texts (DetectRL, short answers) count as one paragraph
  for (const p of pick) {
    const x = T.extract({ text: p }); if (!x) continue;
    rows.push({ x, y: d.label === "ai" ? 1 : 0, group: d.group, doc: d, modern: /opus-5\.5|sonnet-5\.5|haiku-5\.5|imitation/.test(d.model) });
  }
}
console.log(`paragraph rows (fold A): ${rows.length} (${rows.filter(r => r.y).length} AI) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const M = T.trainAll(rows, { useRules: true, useStyle: true, useVocab: true, useChr: true, modernWeight: 4, humanWeight: 2 }, { l2: 0.01, gbdt: true, members: 3, hiPct: 0.999, genrePct: 0.999 });
const J = T.toJSON(M);
const model = JSON.parse(fs.readFileSync(OUT, "utf8"));
model.paraModel = { features: J.features, ruleKeys: J.ruleKeys, styleKeys: J.styleKeys, vocab: J.vocab, classVocab: J.classVocab, useChr: J.useChr, mu: J.mu, sd: J.sd,
  members: J.members, gbdt: J.gbdt, calibration: J.calibration, length: J.length, trainedOn: `${rows.length} paragraphs from ${args.includes("--all") ? "all training documents" : "cross-fit fold A"}` };
fs.writeFileSync(OUT, JSON.stringify(model));
console.log(`wrote paraModel to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

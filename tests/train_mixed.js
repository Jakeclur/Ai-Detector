// Train the v14 mixed-authorship model and store it in src/model.json as `mixedModel` (the rest of the file is kept).
//   node tests/train_mixed.js [--pct=0.998] [--dry]
// Training data: TRAIN-split documents only. Each human training document with 3+ paragraphs is used twice: as is
// (every paragraph labelled 0) and with one or two real AI paragraphs from a training AI document inserted
// (tests/lib/mixed.js; inserted paragraphs labelled 1). Grouped 5-fold cross-validation by host document gives
// out-of-fold scores; the document cut-off is the --pct percentile of the best paragraph score on the pure human
// documents (so about 1 - pct of real human documents would be labelled Mixed), never below 0.5.
const fs = require("fs"), path = require("path");
const ENS = require("../src/ensemble.js");
const D = require("./lib/datasets.js");
const { buildMixed } = require("./lib/mixed.js");
const { fitGBDT, predictGBDT, packGBDT } = require("./lib/gbdt.js");

const args = process.argv.slice(2);
const PCT = +((args.find(a => a.startsWith("--pct=")) || "=0.998").split("=")[1]);
const DRY = args.includes("--dry");
const OUT = (args.find(a => a.startsWith("--model=")) || "").split("=")[1] || path.join(__dirname, "../src/model.json");   // --model=path: read and write another model file

const t0 = Date.now();
const docs = D.all(); D.markLeaks(docs);
// --unseen (default): build training documents only from training-split texts the shipped general model never saw
// (Ghostbuster files above 900 / Reuters above 6, which v12 skipped; the independent Claude training half; DetectRL
// training texts as AI paragraphs when DRL_TRAIN=1). On texts the general model trained on, its paragraph scores are
// over-confident, and a mixed model trained on them learned to expect that (train cross-validation 32% vs dev 14%).
const ALL = args.includes("--all");
const unseen = d => d.split === "train" && (ALL || (d.fileNo && d.fileNo > (d.source.startsWith("ghostbuster/reuter/") ? 6 : 900)) || d.source.startsWith("claude_indep") || d.source.startsWith("detectrl_train"));
// --crossfit: every training document is scored by a copy of the general model that never saw its fold
// (tests/crossfit.js), so paragraph scores are as realistic as on new text. Uses all training hosts.
const CROSS = args.includes("--crossfit");
let CF = null, foldOf = null;
if (CROSS) {
  const crypto = require("crypto");
  foldOf = g => (parseInt(crypto.createHash("md5").update(g + "|crossfit").digest("hex").slice(0, 8), 16) % 2) ? "B" : "A";
  CF = { A: JSON.parse(fs.readFileSync(path.join(__dirname, ".cache/crossfit_A.json"), "utf8")), B: JSON.parse(fs.readFileSync(path.join(__dirname, ".cache/crossfit_B.json"), "utf8")) };
}
const SHIPPED = JSON.parse(fs.readFileSync(OUT, "utf8"));
if (!CROSS) ENS.setModel(SHIPPED);   // features use this file's general and paragraph models
const VARIANTS = +((args.find(a => a.startsWith("--variants=")) || "=1").split("=")[1]);
// --fold=B: only training documents of cross-fit fold B (the paragraph classifier is trained on fold A)
const FOLD = (args.find(a => a.startsWith("--fold=")) || "").split("=")[1];
const foldOfD = g => (parseInt(require("crypto").createHash("md5").update(g + "|crossfit").digest("hex").slice(0, 8), 16) % 2) ? "B" : "A";
const inTrain = FOLD ? (d => d.split === "train" && foldOfD(d.group) === FOLD) : (CROSS || ALL) ? (d => d.split === "train") : unseen;
const mixed = buildMixed(docs, inTrain, { seed: "mixed-train", variants: VARIANTS });
console.log(`train hosts with a mixed version: ${mixed.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// rows: one per eligible paragraph
const rows = [];
let curFold = null;
function addDoc(text, aiStarts, group, kind) {
  if (CROSS) { const f = foldOf(group); if (f !== curFold) { ENS.setModel(CF[f]); curFold = f; } }
  const r = ENS.assess(text, { noCache: true }); if (r.tooShort) return;
  const P = ENS.paraFeatures(text, r.model ? r.model.z : 0); if (!P) return;
  for (const q of P) rows.push({ v: q.v, y: aiStarts.some(s => Math.abs(s - q.start) < 3) ? 1 : 0, group, kind, docId: group + "|" + kind });
}
let k = 0;
for (const m of mixed) {
  // character offsets of the inserted paragraphs in m.text
  const starts = []; let off = 0;
  m.paras.forEach((p, i) => { const at = m.text.indexOf(p, off); if (m.aiParas.includes(i)) starts.push(at); off = at + p.length; });
  addDoc(m.text, starts, m.host.group, m.variant ? "mixed" + m.variant : "mixed");
  if (!m.variant) addDoc(m.human, [], m.host.group, "human");
  if (++k % 500 === 0) console.log(`  ${k}/${mixed.length} hosts, ${rows.length} paragraphs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const d = rows[0].v.length;
const mu = new Array(d).fill(0), sd = new Array(d).fill(0);
for (const r of rows) r.v.forEach((x, j) => { mu[j] += x / rows.length; });
for (const r of rows) r.v.forEach((x, j) => { sd[j] += (x - mu[j]) ** 2 / rows.length; });
for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
const X = rows.map(r => Float64Array.from(r.v.map((x, j) => (x - mu[j]) / sd[j]))), y = rows.map(r => r.y);
const nPos = y.filter(v => v).length, nNeg = y.length - nPos;
const w = y.map(v => v ? 0.5 / nPos * y.length : 0.5 / nNeg * y.length);
console.log(`paragraph rows: ${rows.length} (${nPos} AI, ${nNeg} human)`);

// grouped 5-fold out-of-fold scores
const groups = [...new Set(rows.map(r => r.group))];
const fold = new Map(groups.map((g, i) => [g, i % 5]));
const oof = new Float64Array(rows.length);
const GB = { trees: 300, depth: 3, lr: 0.06, minLeaf: 30, colsample: 0.7 };
for (let f = 0; f < 5; f++) {
  const tr = rows.map((r, i) => fold.get(r.group) !== f ? i : -1).filter(i => i >= 0), te = rows.map((r, i) => fold.get(r.group) === f ? i : -1).filter(i => i >= 0);
  const m = fitGBDT(tr.map(i => X[i]), tr.map(i => y[i]), tr.map(i => w[i]), GB);
  for (const i of te) oof[i] = predictGBDT(m, X[i]);
  console.log(`  fold ${f + 1}/5 done (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
// Platt calibration (balanced) on out-of-fold logits
let a = 1, c = 0;
for (let it = 0; it < 300; it++) { let ga = 0, gc = 0; for (let i = 0; i < rows.length; i++) { const p = 1 / (1 + Math.exp(-(a * oof[i] + c))); ga += (p - y[i]) * oof[i] * w[i]; gc += (p - y[i]) * w[i]; } a -= 0.5 * ga / rows.length; c -= 0.5 * gc / rows.length; }
const prob = z => 1 / (1 + Math.exp(-(a * z + c)));
// document level: best paragraph per document
const byDoc = new Map();
rows.forEach((r, i) => { const p = prob(oof[i]); const e = byDoc.get(r.docId) || { kind: r.kind, best: 0, bestIsAI: false }; if (p > e.best) { e.best = p; e.bestIsAI = !!r.y; } byDoc.set(r.docId, e); });
const H = [...byDoc.values()].filter(e => e.kind === "human").map(e => e.best).sort((p, q) => p - q);
const Mx = [...byDoc.values()].filter(e => e.kind.startsWith("mixed"));
const cut = Math.max(0.5, H[Math.min(H.length - 1, Math.floor(PCT * H.length))]);
const tp = Mx.filter(e => e.best >= cut).length, loc = Mx.filter(e => e.best >= cut && e.bestIsAI).length, fp = H.filter(p => p >= cut).length;
console.log(`OOF (train): cut ${cut.toFixed(4)} at the ${PCT} percentile; mixed docs caught ${tp}/${Mx.length} (${(tp / Mx.length * 100).toFixed(1)}%), right paragraph ${loc}; human docs over the cut ${fp}/${H.length}`);
for (const q of [0.99, 0.995, 0.998, 0.999]) { const cq = Math.max(0.5, H[Math.min(H.length - 1, Math.floor(q * H.length))]); console.log(`   at ${q}: cut ${cq.toFixed(3)}, caught ${(Mx.filter(e => e.best >= cq).length / Mx.length * 100).toFixed(1)}%`); }

// final model on all rows
const full = fitGBDT(X, y, w, GB);
const imp = new Array(d).fill(0); for (const t of full.trees) for (const nd of t) if (nd.f !== undefined) imp[nd.f] += 1;
console.log("feature use:", ENS.MIX_NAMES.map((n, j) => [n, imp[j]]).sort((p, q) => q[1] - p[1]).slice(0, 12).map(([n, g]) => `${n} ${g.toFixed(0)}`).join(", "));
if (!DRY) {
  const M = SHIPPED;
  M.mixedModel = { names: ENS.MIX_NAMES.slice(0, d), mu: mu.map(v => +v.toFixed(6)), sd: sd.map(v => +v.toFixed(6)), gbdt: packGBDT(full), calibration: { a: +a.toFixed(6), c: +c.toFixed(6) }, cut: +cut.toFixed(4), pct: PCT,
    trainedOn: `${Mx.length} mixed + ${H.length} human training documents`, oof: { caught: tp / Mx.length, humanOverCut: fp / H.length } };
  fs.writeFileSync(OUT, JSON.stringify(M));
  console.log(`wrote mixedModel to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

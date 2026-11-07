// Train the v10 classifier and write src/model.json.
//   node tests/train.js            (needs tests/data/ghostbuster and tests/data/dataset.json; see README)
//   node tests/train.js --report   (also print held-out results for each feature-set ablation)
//
// What it does:
//   1. loads every labelled document (tests/lib/datasets.js) and keeps only the "train" split
//   2. extracts three feature families: the rule clues (src/core.js), statistical/structural/semantic
//      features (src/stats.js) and a function-word profile (the ~300 most common tokens)
//   3. fits an L2-regularised logistic regression AND small gradient-boosted trees (blended 50/50; the trees
//      can learn combinations of clues) with fairness constraints:
//        - rule clues keep their direction (an "AI habit" can't become a human sign and vice versa)
//        - contractions, slips and slang can only push towards human
//        - human texts count 2x in the loss
//   4. 5-fold cross-validation BY GROUP (texts written for the same prompt stay together) gives
//      out-of-fold scores, used for Platt calibration and for choosing the cut-offs per genre
//   5. trains 7 bootstrap members on all training data; their disagreement is the uncertainty
// The test split is never touched here. tests/benchmark.js reports on it.
const fs = require("fs");
const path = require("path");
const E = require("../src/core.js");
const S = require("../src/stats.js");
const D = require("./lib/datasets.js");
const GB = require("./lib/gbdt.js");
const GBDT_OPTS = { trees: 250, depth: 3, lr: 0.08, lambda: 5, minLeaf: 40, colsample: 0.5 };

const ARGS = process.argv.slice(2);
const OUT = path.join(__dirname, "../src/model.json");
let HUMAN_WEIGHT = 2, MODERN_WEIGHT = 8;   // modern (2025-26) AI samples are few, so each counts more
const RULE_KEYS = Object.keys(E.MODEL.w);
const RULE_SIGN = Object.fromEntries(RULE_KEYS.map(k => [k, E.MODEL.w[k] < 0 || k === "cite" ? -1 : 1]));
const FAIR_NEG = /'|^(?:lol|tbh|idk|gonna|wanna|kinda|yeah|nah|ok|okay|u|ur|ngl|haha|omg)$/;   // only allowed to lower the score

function extract(doc) {
  const text = E.cleanText(doc.text).text;
  if (E.nWords(text) < 40) return null;
  const F = E.features(text), sf = S.styleFeatures(text);
  return { rules: F.f, style: sf.f, tok: sf.tok, cls: sf.cls, chr: sf.chr, n: sf.n, genre: S.guessGenre(text, sf), wc: F.wc };
}

function buildVocab(rows) {
  const dfH = new Map(), dfA = new Map(); let nH = 0, nA = 0;
  for (const r of rows) { const m = r.y ? dfA : dfH; r.y ? nA++ : nH++; for (const t of r.x.tok.keys()) m.set(t, (m.get(t) || 0) + 1); }
  return [...new Set([...dfH.keys(), ...dfA.keys()])]
    .filter(t => !/[0-9]/.test(t) && (dfH.get(t) || 0) / nH >= 0.03 && (dfA.get(t) || 0) / nA >= 0.03)
    .sort((a, b) => ((dfH.get(b) || 0) + (dfA.get(b) || 0)) - ((dfH.get(a) || 0) + (dfA.get(a) || 0))).slice(0, 300);
}

function buildClassVocab(rows, n) {
  const df = new Map();
  for (const r of rows) for (const t of r.x.cls.keys()) df.set(t, (df.get(t) || 0) + 1);
  return [...df.entries()].filter(([, c]) => c / rows.length >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

// Taught essay conventions that can be excluded from the detection models (opts.neutral). Tested in v13 and
// rejected: removing them made the model lean on correlated signals instead.
const NEUTRAL_RULES = new Set(["summ", "trans"]);
const NEUTRAL_STYLE = new Set(["intro_concl", "discourse"]);
const NEUTRAL_TOK = new Set(["conclusion", "moreover", "furthermore", "additionally", "however", "overall", "ultimately", "therefore", "thus", "firstly", "secondly", "finally", "lastly", "consequently", "hence", "summary", "conclude", "essay", "thesis", "argues"]);

function vectorise(x, spec) {
  const v = new Float64Array(spec.names.length); let i = 0;
  if (spec.useRules) for (const k of spec.ruleKeys) v[i++] = Math.min(x.rules[k], E.MODEL.cap[k] ?? Infinity);
  if (spec.useStyle) for (const k of spec.styleKeys) v[i++] = x.style[k];
  if (spec.useVocab) { const n = Math.max(1, x.n); for (const t of spec.vocab) v[i++] = Math.sqrt((x.tok.get(t) || 0) / n * 100); }
  if (spec.useClass) { const n = Math.max(1, x.n); for (const t of spec.classVocab) v[i++] = Math.sqrt((x.cls.get(t) || 0) / n * 100); }
  if (spec.useChr) for (let k = 0; k < 512; k++) v[i++] = x.chr[k];
  return v;
}

function makeSpec(rows, opts) {
  // v13 experiment, rejected: neutralising these made results worse (recall 81% -> 69%) and the owner's essay went
  // from 84 to 98. Kept switchable (opts.neutral === true) for future tests; off by default.
  const neutral = opts.neutral === true;
  const styleKeys = Object.keys(rows[0].x.style).filter(k => !(neutral && NEUTRAL_STYLE.has(k)));
  const ruleKeys = RULE_KEYS.filter(k => !(neutral && NEUTRAL_RULES.has(k)));
  const vocab = opts.useVocab ? buildVocab(rows).filter(t => !(neutral && NEUTRAL_TOK.has(t))) : [];
  const classVocab = opts.useClass ? buildClassVocab(rows, opts.classN || 200) : [];
  const names = [...(opts.useRules ? ruleKeys.map(k => "rule:" + k) : []), ...(opts.useStyle ? styleKeys.map(k => "style:" + k) : []), ...vocab.map(t => "tok:" + t), ...classVocab.map(t => "cls:" + t), ...(opts.useChr ? Array.from({ length: 512 }, (_, k) => "chr:" + k) : [])];
  const sign = names.map(n => n.startsWith("rule:") ? RULE_SIGN[n.slice(5)] : n.startsWith("tok:") && FAIR_NEG.test(n.slice(4)) ? -1 : n.startsWith("cls:") && n.includes("CONTR") ? -1 : 0);
  return { ...opts, ruleKeys, styleKeys, vocab, classVocab, names, sign };
}

function standardise(X, spec) {
  const d = spec.names.length, mu = new Float64Array(d), sd = new Float64Array(d);
  for (const v of X) for (let j = 0; j < d; j++) mu[j] += v[j] / X.length;
  for (const v of X) for (let j = 0; j < d; j++) sd[j] += (v[j] - mu[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { mu, sd };
}

// weighted L2 logistic regression with Adam and sign constraints (projected)
let L2 = 0.01;
function fitLogistic(X, y, w, spec, { l2 = L2, iters = 500, lr = 0.05 } = {}) {
  const d = spec.names.length, beta = new Float64Array(d); let b = 0;
  const m = new Float64Array(d + 1), v2 = new Float64Array(d + 1);
  const W = w.reduce((a, c) => a + c, 0);
  for (let it = 1; it <= iters; it++) {
    const g = new Float64Array(d + 1);
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]; let z = b; for (let j = 0; j < d; j++) z += beta[j] * xi[j];
      const e = (1 / (1 + Math.exp(-z)) - y[i]) * w[i];
      for (let j = 0; j < d; j++) g[j] += e * xi[j]; g[d] += e;
    }
    for (let j = 0; j <= d; j++) {
      const gj = g[j] / W + (j < d ? l2 * beta[j] : 0);
      m[j] = 0.9 * m[j] + 0.1 * gj; v2[j] = 0.999 * v2[j] + 0.001 * gj * gj;
      const step = lr * (m[j] / (1 - 0.9 ** it)) / (Math.sqrt(v2[j] / (1 - 0.999 ** it)) + 1e-8);
      if (j < d) { beta[j] -= step; if (spec.sign[j] > 0 && beta[j] < 0) beta[j] = 0; if (spec.sign[j] < 0 && beta[j] > 0) beta[j] = 0; } else b -= step;
    }
  }
  return { beta, b };
}
const logit = (m, v) => { let z = m.b; for (let j = 0; j < v.length; j++) z += m.beta[j] * v[j]; return z; };
// short texts carry less evidence: their logit is shrunk towards 0 before calibration (same rule at run time)
const LENGTH = { min: 0.3, full: 300 };
const lenFactor = wc => Math.max(LENGTH.min, Math.min(1, (wc - 40) / (LENGTH.full - 40)));

function weightsFor(rows) {
  const nH = rows.filter(r => !r.y).length, nA = rows.filter(r => r.y).length;
  return rows.map(r => r.y ? (r.modern ? MODERN_WEIGHT : 1) : HUMAN_WEIGHT * nA / nH);
}

// group k-fold: returns out-of-fold logits
function crossValidate(rows, spec, Z, k = 5, useGbdt = false) {
  const groups = [...new Set(rows.map(r => r.group))];
  const fold = new Map(groups.map(g => [g, parseInt(require("crypto").createHash("md5").update(g).digest("hex").slice(0, 6), 16) % k]));
  const oof = new Float64Array(rows.length);
  for (let f = 0; f < k; f++) {
    const tr = rows.map((r, i) => i).filter(i => fold.get(rows[i].group) !== f);
    const w = weightsFor(tr.map(i => rows[i]));
    const m = fitLogistic(tr.map(i => Z[i]), tr.map(i => rows[i].y), w, spec);
    const g = useGbdt ? GB.fitGBDT(tr.map(i => Z[i]), tr.map(i => rows[i].y), w, { ...GBDT_OPTS, sign: spec.sign }) : null;
    // blend: average of the linear logit and the boosted-tree logit, then the length shrink
    rows.forEach((r, i) => { if (fold.get(r.group) === f) oof[i] = (g ? (logit(m, Z[i]) + GB.predictGBDT(g, Z[i])) / 2 : logit(m, Z[i])) * lenFactor(r.x.wc); });
  }
  return oof;
}

// Platt scaling: p = sigmoid(a*z + c), with both classes weighted equally, so the likelihood
// means "assuming a text is equally likely to be human or AI before reading it"
function platt(z, y) {
  const nA = y.filter(v => v).length, nH = y.length - nA, wt = y.map(v => v ? 0.5 / nA : 0.5 / nH);
  let a = 1, c = 0;
  for (let it = 0; it < 4000; it++) {
    let ga = 0, gc = 0;
    for (let i = 0; i < z.length; i++) { const e = (1 / (1 + Math.exp(-(a * z[i] + c))) - y[i]) * wt[i]; ga += e * z[i]; gc += e; }
    a -= 2 * ga; c -= 2 * gc;
  }
  return { a, c };
}

function trainAll(rows, opts, { members = 7, hiPct = 0.997, genrePct = 0.998, l2, gbdt = false } = {}) {
  if (l2 != null) L2 = l2;
  if (opts.modernWeight != null) MODERN_WEIGHT = opts.modernWeight;
  if (opts.humanWeight != null) HUMAN_WEIGHT = opts.humanWeight;
  const spec = makeSpec(rows, opts);
  const X = rows.map(r => vectorise(r.x, spec));
  const { mu, sd } = standardise(X, spec);
  const Z = X.map(v => v.map((x, j) => (x - mu[j]) / sd[j]));
  const oof = crossValidate(rows, spec, Z, 5, gbdt);
  const cal = platt(Array.from(oof), rows.map(r => r.y));
  // cut-offs from out-of-fold HUMAN probabilities: AI-leaning when p >= the 99.7th percentile of humans (stricter
  // per genre where needed); "likely human" when p <= the 95th percentile, so at most ~5% of real people land in
  // "inconclusive"
  const prob = z => 1 / (1 + Math.exp(-(cal.a * z + cal.c)));
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const humP = rows.map((r, i) => [r, prob(oof[i])]).filter(([r]) => !r.y);
  const globalHi = pct(humP.map(x => x[1]), hiPct), globalLo = Math.max(0.5, pct(humP.map(x => x[1]), 0.95));
  const genreCut = {}, genreLo = {};
  for (const g of ["academic", "creative", "news", "explanation", "conversational", "learner", "other"]) {
    const ps = humP.filter(([r]) => r.x.genre === g).map(x => x[1]);
    // genres with few human examples get a stricter cut-off
    genreCut[g] = ps.length >= 100 ? Math.max(globalHi, pct(ps, genrePct)) : Math.max(globalHi, ps.length ? Math.max(...ps) : globalHi, 0.97);
    // "likely human": below 50 (the text looks more human than AI) or the 95th percentile of humans, whichever is higher
    genreLo[g] = Math.max(0.5, ps.length >= 100 ? Math.max(globalLo, pct(ps, 0.95)) : globalLo);
  }
  // bootstrap members on all training data (resampling groups)
  const groups = [...new Set(rows.map(r => r.group))];
  const byGroup = new Map(); rows.forEach((r, i) => { if (!byGroup.has(r.group)) byGroup.set(r.group, []); byGroup.get(r.group).push(i); });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ms = [];
  for (let m = 0; m < members; m++) {
    const idx = []; for (let k = 0; k < groups.length; k++) idx.push(...byGroup.get(groups[Math.floor(rnd() * groups.length)]));
    ms.push(fitLogistic(idx.map(i => Z[i]), idx.map(i => rows[i].y), weightsFor(idx.map(i => rows[i])), spec));
  }
  // training range per feature (for the out-of-distribution check)
  const lo = new Float64Array(spec.names.length).fill(Infinity), hi = new Float64Array(spec.names.length).fill(-Infinity);
  for (const z of Z) for (let j = 0; j < z.length; j++) { if (z[j] < lo[j]) lo[j] = z[j]; if (z[j] > hi[j]) hi[j] = z[j]; }
  // boosted trees on all training data (monotone constraints from the same fairness signs)
  const gb = gbdt ? GB.fitGBDT(Z, rows.map(r => r.y), weightsFor(rows), { ...GBDT_OPTS, sign: spec.sign }) : null;
  return { spec, mu, sd, members: ms, gbdt: gb, cal, cut: { lo: globalLo, hi: globalHi, genre: genreCut, genreLo }, oof, range: { lo, hi } };
}

// ---------- genre classifier (v12): softmax regression over style + common-token features ----------
const GENRES = ["academic", "creative", "news", "explanation", "conversational", "learner", "other"];
const genreLabel = d => d.genre === "docs" ? "other" : GENRES.includes(d.genre) ? d.genre : "other";
function trainGenre(rows) {
  const spec = makeSpec(rows, { useRules: false, useStyle: true, useVocab: true });
  const X = rows.map(r => vectorise(r.x, spec));
  const { mu, sd } = standardise(X, spec);
  const Z = X.map(v => v.map((x, j) => (x - mu[j]) / sd[j]));
  const y = rows.map(r => GENRES.indexOf(genreLabel(r.doc)));
  const K = GENRES.length, d = spec.names.length, W = Array.from({ length: K }, () => new Float64Array(d + 1));
  const cnt = GENRES.map((_, k) => y.filter(v => v === k).length), cw = cnt.map(c => c ? rows.length / (K * c) : 0);
  for (let it = 0; it < 300; it++) {
    const g = Array.from({ length: K }, () => new Float64Array(d + 1));
    for (let i = 0; i < Z.length; i++) {
      const x = Z[i], s = W.map(w => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * x[j]; return z; });
      const mx = Math.max(...s), e = s.map(v => Math.exp(v - mx)), se = e.reduce((a, b) => a + b);
      for (let k = 0; k < K; k++) { const err = (e[k] / se - (y[i] === k ? 1 : 0)) * cw[y[i]]; for (let j = 0; j < d; j++) g[k][j] += err * x[j]; g[k][d] += err; }
    }
    for (let k = 0; k < K; k++) for (let j = 0; j <= d; j++) W[k][j] -= 0.5 * (g[k][j] / Z.length + (j < d ? 0.001 * W[k][j] : 0));
  }
  const r5 = a => Array.from(a, v => +v.toFixed(5));
  const model = { classes: GENRES, features: spec.names, styleKeys: spec.styleKeys, vocab: spec.vocab, mu: r5(mu), sd: r5(sd), W: W.map(r5) };
  const predict = x => { const v = vectorise(x, spec).map((t, j) => (t - mu[j]) / sd[j]); const s = W.map(w => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * v[j]; return z; }); return GENRES[s.indexOf(Math.max(...s))]; };
  return { model, predict };
}

function loadRows(split) {
  const docs = D.all(); D.markLeaks(docs);
  const rows = [];
  for (const d of docs) {
    if (d.split !== split || d.leak) continue;
    if (split === "train" && (d.condition.includes("@") || d.condition === "human-edited-simulated")) continue;
    const x = extract(d); if (!x) continue;
    rows.push({ x, y: d.label === "ai" ? 1 : 0, group: d.group, doc: d, modern: /opus-5\.5|imitation/.test(d.model) });
  }
  return rows;
}

function toJSON(M) {
  const r = a => Array.from(a, v => +v.toFixed(5));
  return {
    version: 10, trained: new Date().toISOString().slice(0, 10),
    features: M.spec.names, ruleKeys: M.spec.useRules ? M.spec.ruleKeys : [], styleKeys: M.spec.useStyle ? M.spec.styleKeys : [], vocab: M.spec.vocab, classVocab: M.spec.classVocab || [], useChr: !!M.spec.useChr,
    mu: r(M.mu), sd: r(M.sd), members: M.members.map(m => ({ b: +m.b.toFixed(5), w: r(m.beta) })),
    calibration: { a: +M.cal.a.toFixed(5), c: +M.cal.c.toFixed(5) },
    cutoffs: { human: +M.cut.lo.toFixed(4), ai: +M.cut.hi.toFixed(4), genre: Object.fromEntries(Object.entries(M.cut.genre).map(([k, v]) => [k, +v.toFixed(4)])),
      humanGenre: Object.fromEntries(Object.entries(M.cut.genreLo || {}).map(([k, v]) => [k, +v.toFixed(4)])) },
    range: { lo: r(M.range.lo), hi: r(M.range.hi) }, length: LENGTH,
    gbdt: M.gbdt ? GB.packGBDT(M.gbdt) : null
  };
}

module.exports = { extract, trainAll, trainGenre, loadRows, vectorise, logit, toJSON, RULE_KEYS, lenFactor };

if (require.main === module) {
  const t0 = Date.now();
  const rows = loadRows("train");
  console.log(`training rows: ${rows.length} (${rows.filter(r => !r.y).length} human, ${rows.filter(r => r.y).length} AI) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // 0) genre classifier, for the "type of writing" shown on the page (84.6% held-out accuracy vs 35.9% for the
  //    heuristic). The cut-offs still use the heuristic genre: using the classifier for cut-offs was tested and made
  //    results slightly worse (zero-sum: tighter genres also move the high-scoring humans).
  const GM = trainGenre(rows);
  // 1) general model: every training text
  // cut-offs at the 99.8th / 99.9th percentile of out-of-fold human scores: by construction about 0.1-0.2% of real
  // people score above them. (A 99.3rd-percentile cut-off looked good on one held-out run but flagged 0.7% of humans
  // after retraining, as its percentile implies, so it was rejected.)
  // v12: + hashed character 3-grams (useChr). At zero held-out false positives they raised recall 81.9% -> 85.6%
  // (humaniser text 46% -> 67%, Claude 2023 54% -> 64%, paraphrased 64% -> 70%). Cut-offs at the 99.9th / 99.95th
  // percentile: at 99.8th the new model flagged one more reformatted human essay than v11, so it was made stricter.
  const M = trainAll(rows, { useRules: true, useStyle: true, useVocab: true, useChr: true, modernWeight: 8, humanWeight: 2 }, { l2: 0.01, gbdt: true, hiPct: 0.999, genrePct: 0.9995 });
  const json = toJSON(M);
  // 2) specialist for recent Claude: Opus 5.5 texts vs all human texts, with a stricter cut-off.
  //    The general model is dominated by 2023 writing; this one only looks for what separates modern Claude.
  const spec = rows.filter(r => !r.y || r.doc.model === "claude-opus-5.5");
  const S = toJSON(trainAll(spec, { useRules: true, useStyle: true, useVocab: true, modernWeight: 1, humanWeight: 1 }, { l2: 0.03, hiPct: 0.998, genrePct: 0.998, members: 5 }));
  json.specialists = [{ name: "claude-modern", label: "recent Claude (Opus 5.5-like)", features: S.features, ruleKeys: S.ruleKeys, styleKeys: S.styleKeys, vocab: S.vocab,
    mu: S.mu, sd: S.sd, members: S.members, calibration: S.calibration, cutoffs: { ai: S.cutoffs.ai }, length: S.length, trainedOn: spec.filter(r => r.y).length + " Opus 5.5 texts",
    minGeneral: 0.05 }];   // only counts when the general model gives at least 5%: stops extreme disagreements (a Reddit dialogue story scored 0 vs 0.92)
  // 3) humaniser specialist: AI text run through a humaniser tool vs all human texts (strict cut-off)
  const hum = rows.filter(r => !r.y || r.doc.condition === "humaniser");
  const HS = toJSON(trainAll(hum, { useRules: true, useStyle: true, useVocab: true, modernWeight: 1, humanWeight: 1 }, { l2: 0.03, hiPct: 0.999, genrePct: 0.999, members: 5 }));
  json.specialists.push({ name: "humaniser", label: "AI text run through a humaniser tool", features: HS.features, ruleKeys: HS.ruleKeys, styleKeys: HS.styleKeys, vocab: HS.vocab,
    mu: HS.mu, sd: HS.sd, members: HS.members, calibration: HS.calibration, cutoffs: { ai: HS.cutoffs.ai }, length: HS.length, minGeneral: 0.05 });
  // 4) attribution: Claude vs ChatGPT, trained on AI texts only (held-out accuracy 95-98% on real 2023 and Opus 5.5 text)
  const fam = d => /claude/.test(d.model) ? 1 : /gpt|chatgpt/.test(d.model) ? 0 : null;
  const at = rows.filter(r => r.y && fam(r.doc) !== null).map(r => ({ ...r, y: fam(r.doc), modern: /opus/.test(r.doc.model) }));
  const A = toJSON(trainAll(at, { useRules: true, useStyle: true, useVocab: true, modernWeight: 5, humanWeight: 1, neutral: false }, { l2: 0.01, gbdt: true, members: 3 }));
  json.attribution = { classes: ["chatgpt", "claude"], features: A.features, ruleKeys: A.ruleKeys, styleKeys: A.styleKeys, vocab: A.vocab, mu: A.mu, sd: A.sd,
    members: A.members, calibration: A.calibration, length: A.length, gbdt: A.gbdt, trainedOn: `${at.filter(r => r.y).length} Claude and ${at.filter(r => !r.y).length} ChatGPT texts` };
  json.genreModel = GM.model;
  fs.writeFileSync(OUT, JSON.stringify(json));
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s; cut-offs`, json.cutoffs, "specialist cut", S.cutoffs.ai);
}

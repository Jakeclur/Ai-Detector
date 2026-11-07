// ==ENSEMBLE==
/* =====================================================================
   v10 assessment: combines the rule engine (core.js), the statistical
   features (stats.js) and the trained classifier (model.json).
   Every part has a fallback: if the model can't be used, the rule
   engine's v9 score is used and the result says so.
   ===================================================================== */
const ASSESS_CACHE = new Map();

function scoreWith(M, R, sf, wc) {
  const v = modelVector(M, R, sf);
  const zs = M.members.map(m => { let z = m.b; for (let j = 0; j < v.length; j++) z += m.w[j] * v[j]; return z; });
  const L = M.length || { min: 0.3, full: 300 };
  const lf = Math.max(L.min, Math.min(1, (wc - 40) / (L.full - 40)));
  const zl = zs.reduce((a, b) => a + b, 0) / zs.length;
  const z = (M.gbdt ? (zl + gbdtLogit(M.gbdt, v)) / 2 : zl) * lf;
  return 1 / (1 + Math.exp(-(M.calibration.a * z + M.calibration.c)));
}
function modelVector(M, R, sf) {
  const v = new Float64Array(M.features.length); let i = 0;
  for (const k of M.ruleKeys) v[i++] = Math.min(R.f[k], (MODEL.cap[k] ?? Infinity));
  for (const k of M.styleKeys) v[i++] = sf.f[k];
  const n = Math.max(1, sf.n);
  for (const t of M.vocab) v[i++] = Math.sqrt((sf.tok.get(t) || 0) / n * 100);
  for (const t of (M.classVocab || [])) v[i++] = Math.sqrt((sf.cls.get(t) || 0) / n * 100);
  if (M.useChr) for (let k = 0; k < 512; k++) v[i++] = sf.chr[k];   // v12: hashed character 3-grams
  for (let j = 0; j < v.length; j++) v[j] = (v[j] - M.mu[j]) / M.sd[j];
  return v;
}

// boosted trees (packed: [leaf] or [feature, threshold, left, right])
function gbdtLogit(G, v) {
  let z = G.base;
  for (const t of G.trees) { let k = 0; for (;;) { const nd = t[k]; if (nd.length === 1) { z += nd[0]; break; } k = v[nd[0]] <= nd[1] ? nd[2] : nd[3]; } }
  return z;
}
// v12: trained genre classifier (falls back to the heuristic guessGenre)
function predictGenre(R, sf) {
  const G = typeof DETECTOR_MODEL !== "undefined" && DETECTOR_MODEL ? DETECTOR_MODEL.genreModel : null;
  if (!G) return null;
  const v = modelVector({ features: G.features, ruleKeys: [], styleKeys: G.styleKeys, vocab: G.vocab, mu: G.mu, sd: G.sd }, R, sf);
  const d = v.length, s = G.W.map(w => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * v[j]; return z; });
  return G.classes[s.indexOf(Math.max(...s))];
}
// Score a text with the trained model. Returns null when no model is loaded.
function modelScore(text, R, sf) {
  const M = typeof DETECTOR_MODEL !== "undefined" ? DETECTOR_MODEL : null;
  if (!M || !M.members) return null;
  const v = modelVector(M, R, sf);
  const zs = M.members.map(m => { let z = m.b; for (let j = 0; j < v.length; j++) z += m.w[j] * v[j]; return z; });
  // short texts carry less evidence: shrink towards 0 (same rule as in training)
  const L = M.length || { min: 0.3, full: 300 }, wc = nWords(text);
  const lf = Math.max(L.min, Math.min(1, (wc - 40) / (L.full - 40)));
  const zLin = zs.reduce((a, b) => a + b, 0) / zs.length;
  const sdLin = Math.sqrt(zs.reduce((a, b) => a + (b - zLin) ** 2, 0) / zs.length);
  let z, zsd;
  if (M.gbdt) {
    // v11: blend of the linear ensemble and the boosted trees; their disagreement adds to the uncertainty
    const zG = gbdtLogit(M.gbdt, v);
    z = (zLin + zG) / 2 * lf;
    zsd = Math.sqrt((sdLin * lf / 2) ** 2 + ((zLin - zG) * lf / 2) ** 2);
  } else { z = zLin * lf; zsd = sdLin * lf; }
  const cal = x => 1 / (1 + Math.exp(-(M.calibration.a * x + M.calibration.c)));
  // contribution of each feature family (mean member weights x standardised value), for the explanation
  const fam = { rules: 0, style: 0, words: 0 }, top = []; let chrSum = 0;
  const w = M.features.map((_, j) => M.members.reduce((a, m) => a + m.w[j], 0) / M.members.length);
  M.features.forEach((name, j) => { const c = w[j] * v[j]; fam[name.startsWith("rule:") ? "rules" : name.startsWith("style:") || name.startsWith("cls:") || name.startsWith("chr:") ? "style" : "words"] += c; if (name.startsWith("chr:")) chrSum += c; else top.push([name, c, v[j]]); });
  // the 512 hashed character patterns have no readable names: shown as one combined row
  if (chrSum) top.push(["style:_chr", chrSum, chrSum]);
  top.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  // out-of-distribution: how many features sit well outside anything seen in training
  let outside = 0; for (let j = 0; j < v.length; j++) { const span = M.range.hi[j] - M.range.lo[j] || 1; if (v[j] > M.range.hi[j] + 0.25 * span || v[j] < M.range.lo[j] - 0.25 * span) outside++; }
  // specialists (e.g. recent Claude): each has its own strict cut-off
  const spec = (M.specialists || []).map(S => ({ name: S.name, label: S.label, p: scoreWith(S, R, sf, wc), cut: S.cutoffs.ai, minGeneral: S.minGeneral || 0, minWords: S.minWords || 0, shortMinGeneral: S.shortMinGeneral ?? 0 }));
  return { p: cal(z), pLow: cal(z - 1.5 * zsd), pHigh: cal(z + 1.5 * zsd), z, zsd, fam, top: top.slice(0, 12), outside, cut: M.cutoffs, spec };
}

function chunkedScore(text, whole) {
  const chunks = []; let cur = [], n = 0;
  for (const p of paraSplit(text)) { cur.push(p); n += nWords(p); if (n >= 600) { chunks.push(cur.join("\n\n")); cur = []; n = 0; } }
  if (cur.length) { if (n < 250 && chunks.length) chunks[chunks.length - 1] += "\n\n" + cur.join("\n\n"); else chunks.push(cur.join("\n\n")); }
  const parts = chunks.map(c => { const R = analyze(c); return R.tooShort ? null : { w: nWords(c), m: modelScore(c, R, styleFeatures(c)) }; }).filter(x => x && x.m);
  if (!parts.length) return whole;
  const W = parts.reduce((a, x) => a + x.w, 0), M = DETECTOR_MODEL;
  const z = parts.reduce((a, x) => a + x.m.z * x.w, 0) / W;
  const zsd = Math.sqrt(parts.reduce((a, x) => a + ((x.m.z - z) ** 2 + x.m.zsd ** 2) * x.w, 0) / W);
  const cal = x => 1 / (1 + Math.exp(-(M.calibration.a * x + M.calibration.c)));
  // a specialist counts only if it fires on the document as a whole: weighted mean of its chunk scores
  const spec = whole.spec.map((s, k) => ({ ...s, p: parts.reduce((a, x) => a + x.m.spec[k].p * x.w, 0) / W }));
  return { ...whole, p: cal(z), pLow: cal(z - 1.5 * zsd), pHigh: cal(z + 1.5 * zsd), z, zsd, spec, chunks: parts.length };
}

// Main entry: everything the page needs about one text.
function assess(raw, opts = {}) {
  const key = raw.length + ":" + raw.slice(0, 200) + raw.slice(-200);
  if (!opts.noCache && ASSESS_CACHE.has(key) && ASSESS_CACHE.get(key).raw === raw) return ASSESS_CACHE.get(key).r;
  const cl = cleanText(raw), text = cl.text;
  const r = analyze(text);
  if (r.tooShort) return { tooShort: true, wc: r.wc };
  r.text = text; r.cleanNotes = cl.notes;
  let sf = null, m = null;
  try {
    sf = styleFeatures(text);
    r.cutGenre = guessGenre(text, sf);              // the genre the cut-offs were calibrated with
    r.genre = predictGenre(r, sf) || r.cutGenre;    // more accurate type of writing, for display
    m = modelScore(text, r, sf);
    // Long documents: the model was trained on texts up to ~1,500 words, and whole-document features
    // (paragraph counts, repeated phrases) drift with length. Score ~600-word chunks and combine them.
    if (m && r.wc > 1500) m = chunkedScore(text, m);
  } catch (e) { r.modelError = String(e && e.message || e); }
  r.rulesScore = r.score;                       // v9 habit score, still shown in the clue panel
  r.model = m;
  if (m) {
    const g = r.cutGenre && m.cut.genre[r.cutGenre] != null ? r.cutGenre : "other";
    const cutAI = m.cut.genre[g] ?? m.cut.ai;
    // a specialist only counts when the general model gives at least some support (stops extreme disagreements)
    // v12.2: on short texts it needs the general model to lean AI too (the recent-Claude one fired on short school answers)
    const hit = m.spec.filter(s => s.p >= s.cut && m.p >= (r.wc < s.minWords ? Math.max(s.minGeneral, s.shortMinGeneral) : s.minGeneral));
    r.specialist = hit.length ? hit[0] : null;
    const pShow = r.specialist ? Math.max(m.p, r.specialist.p) : m.p;
    r.likelihood = Math.round(pShow * 100);
    const cutH = (m.cut.humanGenre && m.cut.humanGenre[g]) ?? m.cut.human;
    let cls = m.p >= cutAI || r.specialist ? "ai" : m.p <= cutH ? "human" : "inconclusive";
    if (r.counts.hard && m.p >= 0.5) cls = "ai";                 // leftover chatbot text
    if (r.counts.edited === 2 && cls === "human") cls = "edited"; // casual touches on an AI skeleton
    r.band = cls;
    // keep `score` on the familiar 0-100 scale for the rest of the page: the likelihood
    r.score = r.likelihood;
    r.cutAI = Math.round(cutAI * 100); r.cutHuman = Math.round(cutH * 100);
  } else {
    r.likelihood = r.score; r.cutAI = BANDS.ai; r.cutHuman = BANDS.human;  // fallback: v9 rule engine
  }
  // agreement between the two independent views: the rule clues and the trained model
  const rulesSide = r.rulesScore >= BANDS.ai ? 1 : r.rulesScore < BANDS.human ? -1 : 0;
  const modelSide = m ? (m.p >= 0.5 ? 1 : -1) : rulesSide;
  r.agree = rulesSide === 0 || rulesSide === modelSide;
  // evidence quality: how much text, and how many independent signal families point the same way
  const fams = m ? Object.values(m.fam).filter(v => Math.abs(v) > 0.3) : [];
  const sameWay = m ? fams.filter(v => Math.sign(v) === Math.sign(m.z)).length : 0;
  r.evidence = r.wc < 150 || (sf && sf.obs.sentences < 6) ? "limited" : r.wc >= 350 && sameWay >= 2 ? "good" : "moderate";
  // unusual layout (poems, lyrics, lists of short lines) is out of distribution for the model
  const lines = text.split("\n").filter(l => l.trim());
  const shortLines = lines.filter(l => nWords(l) <= 8 && !/[.!?:]["')]?\s*$/.test(l.trim())).length;
  r.layoutOdd = lines.length >= 6 && shortLines / lines.length > 0.4;
  r.ood = (m && m.outside >= 3) || r.layoutOdd || (typeof englishCoverage === "function" && englishCoverage(text) < 20);
  // out of distribution: the model's number is much less trustworthy, so pull the estimate strongly towards 50
  if (r.ood && m && r.specialist && m.p < 0.995) r.specialist = null;
  if (r.ood && m) { const zz = m.z * 0.25, M2 = DETECTOR_MODEL; m.p = 1 / (1 + Math.exp(-(M2.calibration.a * zz + M2.calibration.c))); r.likelihood = Math.round((r.specialist ? Math.max(m.p, 0.5) : m.p) * 100); r.score = r.likelihood; }
  // never call an out-of-distribution text AI-leaning unless the evidence is overwhelming or a chatbot left text behind
  if (r.ood && r.band === "ai" && !r.counts.hard && !(m && m.p >= 0.995)) r.band = "inconclusive";
  // v14 mixed authorship (trained paragraph model, DETECTOR_MODEL.mixedModel). Skipped when the whole text is already
  // AI-leaning or out of distribution. r.mix.paras holds every paragraph's probability for the page.
  if (m && DETECTOR_MODEL.mixedModel) {
    r.mix = { mixed: false, model: true };
    if (!r.ood) {
      try {
        const ms = mixedScore(text, m.z);
        if (ms) {
          r.mix.paras = ms.paras.map(q => ({ start: q.start, end: q.end, p: q.p, words: q.wc }));
          r.mix.cut = ms.cut;
          if (ms.best.p >= ms.cut && r.band !== "ai") { r.mix.mixed = true; r.mix.para = { start: ms.best.start, end: ms.best.end, p: ms.best.p }; r.band = "mixed"; }
        }
      } catch (e) { r.mix.error = String(e && e.message || e); }
    }
  }
  const uncertain = m && (m.pHigh - m.pLow) > 0.35;
  r.confidence = r.evidence !== "limited" && r.agree && !r.ood && !uncertain && r.wc >= 250 ? "medium" : "low";
  r.uncertainty = [
    r.wc < 150 ? "The text is short, so there is little evidence either way." : "",
    m && !r.agree ? `The rule clues (${r.rulesScore}) and the trained model (${r.likelihood}) disagree.` : "",
    uncertain ? `The model's ensemble members disagree: the estimate could be anywhere from about ${Math.round(m.pLow * 100)} to ${Math.round(m.pHigh * 100)}.` : "",
    r.ood ? "This text is unlike the texts the model was trained on (unusual style, layout or language), so the estimate is less reliable." : "",
    r.cutGenre && r.cutGenre !== "other" ? "" : "The type of writing wasn't clear, so a general (stricter) cut-off was used."
  ].filter(Boolean);
  r.obs = sf ? sf.obs : null;
  // attribution: trained Claude-vs-ChatGPT model, refining the rule-based clues
  r.attr = attribute(text, r);
  try {
    const AM = typeof DETECTOR_MODEL !== "undefined" && DETECTOR_MODEL ? DETECTOR_MODEL.attribution : null;
    // the attribution model only knows Claude vs ChatGPT for AI text: skip it for human-leaning results
    if (AM && sf && r.band !== "human") {
      const pc = scoreWith(AM, r, sf, r.wc);
      r.attrModel = { pClaude: pc };
      const lean = pc >= 0.65 ? "claude" : pc <= 0.35 ? "chatgpt" : "unclear";
      const strong = Math.abs(pc - 0.5) >= 0.4;
      r.attr.ruleLean = r.attr.lean;
      r.attr.lean = lean;
      r.attr.confidence = lean === "unclear" ? "none" : strong && r.wc >= 200 ? "medium" : "low";
      (lean === "chatgpt" ? r.attr.ev.gpt : r.attr.ev.claude).unshift(`Trained Claude-vs-ChatGPT model: ${Math.round(pc * 100)}% Claude-like (right 95-98% of the time on held-out real texts)`);
      if (lean === "claude") r.attr.claude += 4; else if (lean === "chatgpt") r.attr.gpt += 4;
    }
  } catch (e) { /* keep the rule-based attribution */ }
  if (!opts.noCache) { if (ASSESS_CACHE.size > 200) ASSESS_CACHE.clear(); ASSESS_CACHE.set(key, { raw, r }); }
  return r;
}

// Claude-vs-ChatGPT probability for one piece of text (used for the stand-out paragraph of a Mixed result)
function attributionFor(text) {
  const AM = typeof DETECTOR_MODEL !== "undefined" && DETECTOR_MODEL ? DETECTOR_MODEL.attribution : null;
  if (!AM) return null;
  const R = analyze(text); if (R.tooShort) return null;
  return scoreWith(AM, R, styleFeatures(text), R.wc);
}

// v14 mixed-authorship features. For every paragraph of 30+ words (needs 3+ such paragraphs), describe the paragraph
// on its own (model score, rule clues, style) and how much it differs from the rest of the same document. A trained
// model (DETECTOR_MODEL.mixedModel) turns these into "probability this paragraph was written by AI and dropped into
// otherwise human text". Natural shifts (introductions, conclusions, quotations) are learned from real human documents.
const MIX_FW = ["the", "of", "and", "to", "a", "in", "that", "is", "was", "it", "for", "on", "with", "as", "i", "he", "they", "we", "you", "be", "at", "by", "this", "had", "not", "but", "from", "or", "have", "an", "which", "so", "if", "there", "all", "my", "would", "can", "their", "about", "just", "also", "very", "really", "because", "then", "more", "when", "like", "do", "some", "these", "could", "into", "than", "only", "such", "while", "our", "will", "are", "were"];
const MIX_NAMES = ["zRaw", "zShr", "dzMed", "dzMax", "isTop", "styleDist", "styleOut", "fwDelta", "ruleDiff", "rule", "first", "last", "relPos", "nPara", "logWords", "quote", "cite", "zDoc", "famRules", "famStyle", "famWords", "pz", "dpzMed", "dpzMax"];
function paraFeatures(text, docZ) {
  const M = typeof DETECTOR_MODEL !== "undefined" ? DETECTOR_MODEL : null;
  if (!M || !M.members) return null;
  const items = []; let from = 0;
  const sIdx = M.features.map((n, j) => n.startsWith("style:") ? j : -1).filter(j => j >= 0);
  for (const p of paraSplit(text)) {
    const at = text.indexOf(p, from); if (at < 0) continue; from = at + p.length;
    const wc = nWords(p); if (wc < 30) continue;
    const R = analyze(p, { noShrink: true }); if (R.tooShort) continue;
    const sf = styleFeatures(p), m = modelScore(p, R, sf); if (!m) continue;
    const lf = Math.max(0.3, Math.min(1, (wc - 40) / 260));
    const words = (p.toLowerCase().match(/[a-z']+/g) || []), fw = {};
    for (const w of words) if (MIX_FW.includes(w)) fw[w] = (fw[w] || 0) + 1;
    const sv = sIdx.map(j => (sf.f[M.features[j].slice(6)] - M.mu[j]) / M.sd[j]);
    const quoted = (p.match(/"[^"]{3,}"/g) || []).join("").length / Math.max(1, p.length);
    // v14: paragraph-level classifier (trained on paragraphs, not whole documents), calibrated logit
    let pz = 0;
    if (M.paraModel) { const pp = Math.min(0.9999, Math.max(0.0001, scoreWith(M.paraModel, R, sf, wc))); pz = Math.log(pp / (1 - pp)); }
    items.push({ start: at, end: at + p.length, wc, z: m.z, zRaw: m.z / lf, rule: R.score, sv, fw, n: words.length, quoted, cite: R.f.cite || 0, fam: m.fam, pz });
  }
  if (items.length < 3) return null;
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const fwRate = (fw, n) => MIX_FW.map(w => ((fw[w] || 0) / Math.max(1, n)) * 100);
  const dists = items.map((it, i) => {
    const o = items.filter((_, j) => j !== i), cen = it.sv.map((_, k) => o.reduce((a, x) => a + x.sv[k], 0) / o.length);
    return Math.sqrt(it.sv.reduce((a, v, k) => a + Math.min(25, (v - cen[k]) ** 2), 0) / it.sv.length);
  });
  const medDist = med(dists) || 1;
  return items.map((it, i) => {
    const o = items.filter((_, j) => j !== i), oz = o.map(x => x.zRaw);
    const ofw = {}; let on = 0; for (const x of o) { on += x.n; for (const w in x.fw) ofw[w] = (ofw[w] || 0) + x.fw[w]; }
    const a = fwRate(it.fw, it.n), b = fwRate(ofw, on);
    const fwDelta = MIX_FW.reduce((s, w, k) => s + Math.abs(a[k] - b[k]) / ((FW_STATS.sd[w] || 1)), 0) / MIX_FW.length;
    const v = [it.zRaw, it.z, it.zRaw - med(oz), it.zRaw - Math.max(...oz), it.zRaw >= Math.max(...oz) ? 1 : 0, dists[i], dists[i] / medDist, fwDelta,
      it.rule - med(o.map(x => x.rule)), it.rule, i === 0 ? 1 : 0, i === items.length - 1 ? 1 : 0, items.length > 1 ? i / (items.length - 1) : 0,
      Math.min(items.length, 20), Math.log(it.wc), it.quoted, it.cite, docZ == null ? 0 : docZ, it.fam.rules, it.fam.style, it.fam.words,
      it.pz, it.pz - med(o.map(x => x.pz)), it.pz - Math.max(...o.map(x => x.pz))];
    return { start: it.start, end: it.end, wc: it.wc, v, p: null, zPara: it.z };
  });
}
// score paragraphs with the mixed model; returns { paras, best, cut } or null
function mixedScore(text, docZ) {
  const MM = typeof DETECTOR_MODEL !== "undefined" && DETECTOR_MODEL ? DETECTOR_MODEL.mixedModel : null;
  if (!MM) return null;
  const P = paraFeatures(text, docZ); if (!P) return null;
  let best = null;
  for (const q of P) {
    const x = MM.mu.map((mu, j) => (q.v[j] - mu) / MM.sd[j]);   // a model uses only the features it was trained with
    const z = gbdtLogit(MM.gbdt, x);
    q.p = 1 / (1 + Math.exp(-(MM.calibration.a * z + MM.calibration.c)));
    if (!best || q.p > best.p) best = q;
  }
  return { paras: P, best, cut: MM.cut };
}

// Paragraph-level view: each paragraph scored by the model on its own (short paragraphs are unreliable).
function paragraphView(text) {
  const out = []; let from = 0;
  for (const p of paraSplit(text)) {
    const at = text.indexOf(p, from); if (at < 0) continue; from = at + p.length;
    if (nWords(p) < 40) continue;
    const r = analyze(p); if (r.tooShort) continue;
    let lik = r.score, m = null;
    try { const sf = styleFeatures(p); m = modelScore(p, r, sf); if (m) lik = Math.round(m.p * 100); } catch (e) { /* fall back to rule score */ }
    out.push({ start: at, end: at + p.length, likelihood: lik, rules: r.score, words: nWords(p) });
  }
  return out;
}
// ==/ENSEMBLE==
if (typeof module !== "undefined") {
  const C = require("./core.js"), S = require("./stats.js");
  Object.assign(global, { attribute: C.attribute, cleanText: C.cleanText, analyze: C.analyze, MODEL: C.MODEL, BANDS: C.BANDS, englishCoverage: C.englishCoverage, paraSplit: C.paraSplit, nWords: C.nWords, styleFeatures: S.styleFeatures, guessGenre: S.guessGenre, FW_STATS: C.FW_STATS });
  try { global.DETECTOR_MODEL = require("./model.json"); } catch (e) { /* no model: rule-engine fallback */ }
  module.exports = { attributionFor, assess, modelScore, paragraphView, paraFeatures, mixedScore, MIX_NAMES, setModel: m => { global.DETECTOR_MODEL = m; ASSESS_CACHE.clear(); } };
}

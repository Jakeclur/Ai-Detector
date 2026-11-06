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
  for (let j = 0; j < v.length; j++) v[j] = (v[j] - M.mu[j]) / M.sd[j];
  return v;
}

// boosted trees (packed: [leaf] or [feature, threshold, left, right])
function gbdtLogit(G, v) {
  let z = G.base;
  for (const t of G.trees) { let k = 0; for (;;) { const nd = t[k]; if (nd.length === 1) { z += nd[0]; break; } k = v[nd[0]] <= nd[1] ? nd[2] : nd[3]; } }
  return z;
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
  const fam = { rules: 0, style: 0, words: 0 }, top = [];
  const w = M.features.map((_, j) => M.members.reduce((a, m) => a + m.w[j], 0) / M.members.length);
  M.features.forEach((name, j) => { const c = w[j] * v[j]; fam[name.startsWith("rule:") ? "rules" : name.startsWith("style:") || name.startsWith("cls:") ? "style" : "words"] += c; top.push([name, c, v[j]]); });
  top.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  // out-of-distribution: how many features sit well outside anything seen in training
  let outside = 0; for (let j = 0; j < v.length; j++) { const span = M.range.hi[j] - M.range.lo[j] || 1; if (v[j] > M.range.hi[j] + 0.25 * span || v[j] < M.range.lo[j] - 0.25 * span) outside++; }
  // specialists (e.g. recent Claude): each has its own strict cut-off
  const spec = (M.specialists || []).map(S => ({ name: S.name, label: S.label, p: scoreWith(S, R, sf, wc), cut: S.cutoffs.ai, minGeneral: S.minGeneral || 0 }));
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
    sf = styleFeatures(text); r.genre = guessGenre(text, sf); m = modelScore(text, r, sf);
    // Long documents: the model was trained on texts up to ~1,500 words, and whole-document features
    // (paragraph counts, repeated phrases) drift with length. Score ~600-word chunks and combine them.
    if (m && r.wc > 1500) m = chunkedScore(text, m);
  } catch (e) { r.modelError = String(e && e.message || e); }
  r.rulesScore = r.score;                       // v9 habit score, still shown in the clue panel
  r.model = m;
  if (m) {
    const g = r.genre && m.cut.genre[r.genre] != null ? r.genre : "other";
    const cutAI = m.cut.genre[g] ?? m.cut.ai;
    // a specialist only counts when the general model gives at least some support (stops extreme disagreements)
    const hit = m.spec.filter(s => s.p >= s.cut && m.p >= s.minGeneral);
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
  const uncertain = m && (m.pHigh - m.pLow) > 0.35;
  r.confidence = r.evidence !== "limited" && r.agree && !r.ood && !uncertain && r.wc >= 250 ? "medium" : "low";
  r.uncertainty = [
    r.wc < 150 ? "The text is short, so there is little evidence either way." : "",
    m && !r.agree ? `The rule clues (${r.rulesScore}) and the trained model (${r.likelihood}) disagree.` : "",
    uncertain ? `The model's ensemble members disagree: the estimate could be anywhere from about ${Math.round(m.pLow * 100)} to ${Math.round(m.pHigh * 100)}.` : "",
    r.ood ? "This text is unlike the texts the model was trained on (unusual style, layout or language), so the estimate is less reliable." : "",
    r.genre && r.genre !== "other" ? "" : "The type of writing wasn't clear, so a general cut-off was used."
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
  Object.assign(global, { attribute: C.attribute, cleanText: C.cleanText, analyze: C.analyze, MODEL: C.MODEL, BANDS: C.BANDS, englishCoverage: C.englishCoverage, paraSplit: C.paraSplit, nWords: C.nWords, styleFeatures: S.styleFeatures, guessGenre: S.guessGenre });
  try { global.DETECTOR_MODEL = require("./model.json"); } catch (e) { /* no model: rule-engine fallback */ }
  module.exports = { attributionFor, assess, modelScore, paragraphView, setModel: m => { global.DETECTOR_MODEL = m; ASSESS_CACHE.clear(); } };
}

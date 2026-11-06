// ==STATS==
/* =====================================================================
   Statistical, structural and semantic feature extractors (v10).
   These feed the trained classifier in src/model.json. None of them is an
   "AI sign" on its own: the classifier learned how much each one is worth by
   comparing thousands of real human and AI texts written for the same prompts.
   Vocabulary richness and word length are measured for display only, never
   scored (fairness: they are what make detectors flag non-native writers).
   ===================================================================== */
const ST_FUNC = new Set(("a an the and or but nor so yet for of in on at to from by with about as into onto upon over under " +
  "between through during before after since until while because although though if unless whether than then that this these " +
  "those which who whom whose what when where why how i me my mine we us our you your he him his she her they them their it its " +
  "is am are was were be been being have has had do does did can could will would shall should may might must not no very " +
  "also just only even still too more most much many some any all each every both either neither other such own same there here").split(" "));
const ST_DISCOURSE = /^(?:however|moreover|furthermore|additionally|also|in addition|for example|for instance|in fact|indeed|therefore|thus|hence|consequently|as a result|overall|ultimately|in conclusion|finally|first|firstly|second|secondly|third|lastly|meanwhile|similarly|likewise|in contrast|on the other hand|nevertheless|nonetheless|instead|still|then|next|in short|in summary|importantly|notably|of course|that said|in other words)\b/i;

function stTokens(t) { return t.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)?|[0-9]+|[.,;:!?()"—–]/g) || []; }
function stSentences(t) {
  return t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "").split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])|\n+/).map(s => s.trim()).filter(s => /[A-Za-z]/.test(s));
}
function stWordClass(w, first) {
  if (ST_FUNC.has(w)) return w;
  if (/^[0-9]+$/.test(w)) return "NUM";
  if (/ing$/.test(w)) return "ING";
  if (/ed$/.test(w)) return "ED";
  if (/ly$/.test(w)) return "LY";
  if (/(?:tion|sion|ment|ness|ity|ance|ence)$/.test(w)) return "NOM";
  return first ? "W0" : "W";
}
function stContent(s) { return (s.toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !ST_FUNC.has(w)).map(w => w.replace(/(?:ing|ed|es|s|ly)$/, "")); }
function stMeanSd(a) { if (!a.length) return [0, 0]; const m = a.reduce((x, y) => x + y, 0) / a.length; return [m, Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)]; }
function stJaccard(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }
function stCosine(a, b) {
  const ca = new Map(), cb = new Map(); for (const x of a) ca.set(x, (ca.get(x) || 0) + 1); for (const x of b) cb.set(x, (cb.get(x) || 0) + 1);
  let d = 0, na = 0, nb = 0; for (const [k, v] of ca) { na += v * v; if (cb.has(k)) d += v * cb.get(k); } for (const v of cb.values()) nb += v * v;
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

// Coarse grammatical classes for the word-class pattern profile (a cheap stand-in for part-of-speech tags)
const ST_CLASS = {};
for (const [c, ws] of Object.entries({
  DET: "a an the this that these those each every some any no",
  PRON: "i me my mine we us our you your he him his she her they them their it its myself itself themselves",
  PREP: "of in on at to from by with about as into onto upon over under between through during before after since until for without within across against towards toward",
  CONJ: "and or but nor so yet because although though if unless whether while than",
  AUX: "is am are was were be been being have has had do does did can could will would shall should may might must",
  NEG: "not never n't",
  WH: "what when where why how which who whom whose",
  ADV: "very also just only even still too more most much really quite then there here now always often"
})) for (const w of ws.split(" ")) ST_CLASS[w] = c;
function stClassOf(tok, prev) {
  if (ST_CLASS[tok]) return ST_CLASS[tok];
  if (/^[.,;:!?()"—–]$/.test(tok)) return tok;
  if (/^[0-9]+$/.test(tok)) return "NUM";
  if (/'/.test(tok)) return "CONTR";
  if (/ing$/.test(tok)) return "ING";
  if (/ed$/.test(tok)) return "ED";
  if (/ly$/.test(tok)) return "LY";
  if (/(?:tion|sion|ment|ness|ity|ance|ence)s?$/.test(tok)) return "NOM";
  if (/s$/.test(tok) && tok.length > 3) return "WS";
  return "W";
}
// Returns { f: {name: number}, tok: Map(token -> count), cls: Map(class bigram -> count), n: token count, obs: {display-only values} }
function styleFeatures(text) {
  const tok = stTokens(text);
  const words = tok.filter(w => /[a-z0-9]/.test(w));
  const n = Math.max(1, words.length);
  const per100 = c => c / n * 100;
  const counts = new Map(); for (const w of tok) counts.set(w, (counts.get(w) || 0) + 1);
  // word-class bigrams ("DET W", "W PREP", "PRON AUX", ", CONJ", …)
  const cls = new Map(); let prevC = "^";
  for (const w of tok) { const c = stClassOf(w); const k = prevC + " " + c; cls.set(k, (cls.get(k) || 0) + 1); prevC = c === "." || c === "!" || c === "?" ? "^" : c; }
  const cnt = w => counts.get(w) || 0;
  const sents = stSentences(text);
  const lens = sents.map(s => (s.match(/[A-Za-z0-9'’-]+/g) || []).length).filter(x => x > 0);
  const [slMean, slSd] = stMeanSd(lens);
  let skew = 0, ac1 = 0;
  if (lens.length >= 3 && slSd > 0) {
    skew = lens.reduce((a, x) => a + ((x - slMean) / slSd) ** 3, 0) / lens.length;
    let num = 0; for (let i = 1; i < lens.length; i++) num += (lens[i] - slMean) * (lens[i - 1] - slMean);
    ac1 = num / ((lens.length - 1) * slSd * slSd);
  }
  const paras = (typeof paraSplit === "function" ? paraSplit(text) : text.split(/\n\s*\n/)).filter(p => /[A-Za-z]/.test(p));
  const plens = paras.map(p => (p.match(/[A-Za-z0-9'’-]+/g) || []).length);
  const [plMean, plSd] = stMeanSd(plens);

  // structure: sentence templates, paragraph openings, discourse-marker openers
  const tmpl = sents.map(s => { const w = s.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []; return w.slice(0, 3).map((x, i) => stWordClass(x, i === 0)).join(" "); });
  const tcount = new Map(); for (const t of tmpl) if (t) tcount.set(t, (tcount.get(t) || 0) + 1);
  const tmplRep = sents.length >= 4 ? tmpl.filter(t => t && tcount.get(t) > 1).length / sents.length : 0;
  let parallel = 0; for (let i = 1; i < tmpl.length; i++) if (tmpl[i] && tmpl[i] === tmpl[i - 1]) parallel++;
  const opens = paras.map(p => (p.toLowerCase().match(/[a-z]+/g) || []).slice(0, 2).join(" ")).filter(Boolean);
  const ocount = new Map(); for (const o of opens) ocount.set(o, (ocount.get(o) || 0) + 1);
  const openRep = opens.length >= 3 ? opens.filter(o => ocount.get(o) > 1).length / opens.length : 0;
  const discourse = sents.length ? sents.filter(s => ST_DISCOURSE.test(s)).length / sents.length : 0;

  // semantics: overlap between neighbouring sentences, intro vs conclusion, repeated phrases
  const csets = sents.map(s => new Set(stContent(s)));
  const ov = []; for (let i = 1; i < csets.length; i++) ov.push(stJaccard(csets[i - 1], csets[i]));
  const [ovMean, ovSd] = stMeanSd(ov);
  const introConcl = paras.length >= 3 ? stCosine(stContent(paras[0]), stContent(paras[paras.length - 1])) : 0;
  const tri = new Map(); for (let i = 0; i + 3 <= words.length; i++) { const k = words[i] + " " + words[i + 1] + " " + words[i + 2]; tri.set(k, (tri.get(k) || 0) + 1); }
  let triRep = 0; for (const v of tri.values()) if (v > 1) triRep += v;
  triRep = words.length > 3 ? triRep / (words.length - 2) : 0;

  // display-only observations (never scored)
  let mattr = 0, k = 0; for (let i = 0; i + 50 <= words.length; i += 10) { mattr += new Set(words.slice(i, i + 50)).size / 50; k++; }

  const f = {
    sl_mean: slMean, sl_sd: slSd, sl_cv: slMean ? slSd / slMean : 0, sl_skew: skew, sl_ac1: ac1,
    sl_short: lens.length ? lens.filter(x => x <= 8).length / lens.length : 0, sl_long: lens.length ? lens.filter(x => x >= 30).length / lens.length : 0,
    para_n: Math.log1p(paras.length), para_cv: plMean ? plSd / plMean : 0, para_sents: paras.length ? sents.length / paras.length : 0,
    p_comma: per100(cnt(",")), p_semi: per100(cnt(";")), p_colon: per100(cnt(":")), p_dash: per100(cnt("—") + cnt("–")), p_paren: per100(cnt("(")),
    p_quote: per100(cnt('"')), p_q: per100(cnt("?")), p_excl: per100(cnt("!")), p_hyph: per100((text.match(/\w-\w/g) || []).length),
    pr_i: per100(cnt("i") + cnt("me") + cnt("my")), pr_we: per100(cnt("we") + cnt("us") + cnt("our")), pr_you: per100(cnt("you") + cnt("your")),
    pr_3: per100(cnt("he") + cnt("she") + cnt("they") + cnt("him") + cnt("her") + cnt("them") + cnt("his") + cnt("their")),
    digits: per100(words.filter(w => /^[0-9]+$/.test(w)).length), caps: per100((text.match(/(?<=[a-z,;] )[A-Z][a-z]+/g) || []).length),
    tmpl_rep: tmplRep, parallel: sents.length > 1 ? parallel / (sents.length - 1) : 0, open_rep: openRep, discourse,
    ov_mean: ovMean, ov_sd: ovSd, intro_concl: introConcl, tri_rep: triRep
  };
  return { f, tok: counts, cls, n: tok.length, obs: { mattr: k ? mattr / k : 0, wordLen: words.reduce((a, w) => a + w.length, 0) / n, sentences: lens.length, paragraphs: paras.length } };
}

// Rough genre guess, used for genre-aware cut-offs and for the out-of-distribution check.
function guessGenre(text, sf) {
  const t = text, f = sf.f;
  const s = {
    conversational: (/^\s*(?:hi|hey|hello|dear|good (?:morning|afternoon))\b[^\n]{0,40}[,!\n]/i.test(t) ? 2 : 0) + (/\n\s*(?:cheers|thanks|regards|best|kind regards|love|sincerely|yours)[,!.]?\s*\n?[^\n]{0,30}$/i.test(t) ? 2 : 0) + (f.pr_you > 2 && f.pr_i > 2 ? 1 : 0),
    creative: (f.p_quote > 1.5 ? 1.5 : 0) + (f.pr_3 > 4 ? 1 : 0) + ((t.match(/\b(?:said|whispered|asked|replied|looked|smiled|stared)\b/g) || []).length > 3 ? 1.5 : 0),
    news: ((t.match(/\b(?:said|told|according to|spokesman|spokeswoman|officials?|reported)\b/gi) || []).length >= 3 ? 2 : 0) + (f.digits > 1.5 ? 0.5 : 0) + (f.caps > 4 ? 0.5 : 0),
    academic: (/\([A-Z][A-Za-z-]+,? (?:19|20)\d\d\)|\bthis (?:essay|paper|report|study)\b/i.test(t) ? 2 : 0) + (f.sl_mean > 20 ? 1 : 0) + (f.pr_i + f.pr_you < 0.8 ? 0.5 : 0),
    explanation: (f.pr_you > 1.5 ? 1 : 0) + (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(t) ? 1 : 0) + (/\b(?:how to|step|tips?|you can|you should|make sure)\b/i.test(t) ? 1 : 0)
  };
  let best = "other", bv = 1.4;
  for (const [g, v] of Object.entries(s)) if (v > bv) { best = g; bv = v; }
  return best;
}
// ==/STATS==
if (typeof module !== "undefined") {
  // in Node, borrow paraSplit from core.js
  global.paraSplit = global.paraSplit || require("./core.js").paraSplit;
  module.exports = { styleFeatures, guessGenre, stTokens, stSentences };
}

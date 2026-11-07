// Build mixed-authorship documents: a real human document with one or two real AI paragraphs inserted.
// Used for training the mixed detector (train split) and for testing it (dev / final halves), always from
// documents of the same split, so no text is shared between training and testing.
//
// buildMixed(docs, inSplit, { seed, max }) -> [{ text, human, aiParas: [index...], paras, host, donor }]
//   text     the mixed document (paragraphs joined by blank lines)
//   human    the same host document without the AI paragraph(s) (the matched negative)
//   aiParas  indices (in text's paragraphs) that came from the AI document
const crypto = require("crypto");

const nw = t => (t.match(/\S+/g) || []).length;
const h32 = s => parseInt(crypto.createHash("md5").update(s).digest("hex").slice(0, 8), 16);
function rng(seed) { let x = h32(String(seed)) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

const HOST_GENRES = new Set(["academic", "creative", "news", "learner", "explanation", "other"]);
const paras = t => t.split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean);
const goodHostPara = p => nw(p) >= 25;
// AI paragraphs that a student could plausibly paste: prose, 30-320 words (a narrower range let the model learn the range itself), no list or heading markup
const goodAiPara = p => { const w = nw(p); return w >= 30 && w <= 320 && !/^(#|[-*•]|\d+[.)]|\*\*[^*]+\*\*\s*$)/.test(p) && !/:\s*$/.test(p) && !/\n[-*•]/.test(p); };

function buildMixed(docs, inSplit, opts = {}) {
  const R = rng(opts.seed || "mixed");
  const hosts = docs.filter(d => d.label === "human" && d.condition === "original" && inSplit(d) && HOST_GENRES.has(d.genre) && !d.leak)
    .map(d => ({ d, ps: paras(d.text) })).filter(x => x.ps.filter(goodHostPara).length >= 3 && x.ps.length <= 40);
  const donors = docs.filter(d => d.label === "ai" && (d.condition === "original" || d.condition === "prompt-variant") && inSplit(d) && !d.leak)
    .map(d => ({ d, ps: paras(d.text).filter(goodAiPara) })).filter(x => x.ps.length);
  const byGroup = new Map(), byGenre = new Map();
  for (const x of donors) {
    if (!byGroup.has(x.d.group)) byGroup.set(x.d.group, []); byGroup.get(x.d.group).push(x);
    if (!byGenre.has(x.d.genre)) byGenre.set(x.d.genre, []); byGenre.get(x.d.genre).push(x);
  }
  const out = [];
  // opts.variants > 1 (training only): extra mixed versions of each host with other donors (any AI source, including
  // modern Claude), drawn from a separate random stream so the default (dev / final test sets) is unchanged
  if (opts.variants > 1) {
    const R2 = rng((opts.seed || "mixed") + "-variants"), allD = donors;
    for (const { d, ps } of hosts) for (let v = 1; v < opts.variants; v++) {
      const pool = R2() < 0.5 ? (byGenre.get(d.genre === "learner" ? "academic" : d.genre) || allD) : allD;
      const don = pool[Math.floor(R2() * pool.length)]; if (!don) continue;
      const two = R2() < 0.3 && don.ps.length >= 2, start = Math.floor(R2() * Math.max(1, don.ps.length - (two ? 1 : 0)));
      const ins = two ? don.ps.slice(start, start + 2) : [don.ps[start]];
      const hp = ps.filter(p => nw(p) >= 8), k = Math.floor(R2() * (hp.length + 1));
      const all = [...hp.slice(0, k), ...ins, ...hp.slice(k)];
      out.push({ text: all.join("\n\n"), human: hp.join("\n\n"), aiParas: ins.map((_, i) => k + i), paras: all, host: d, donor: don.d, sameTopic: don.d.group === d.group, variant: v });
    }
  }
  for (const { d, ps } of hosts) {
    // prefer an AI answer to the same prompt (same topic), otherwise the same genre
    const pool = byGroup.get(d.group) || byGenre.get(d.genre === "learner" ? "academic" : d.genre) || [];
    if (!pool.length) continue;
    const don = pool[Math.floor(R() * pool.length)];
    const two = R() < 0.3 && don.ps.length >= 2;
    const start = Math.floor(R() * Math.max(1, don.ps.length - (two ? 1 : 0)));
    const ins = two ? don.ps.slice(start, start + 2) : [don.ps[start]];
    const hp = ps.filter(p => nw(p) >= 8);           // drop stray one-line fragments (titles, page numbers)
    const k = Math.floor(R() * (hp.length + 1));     // any position, including first and last
    const all = [...hp.slice(0, k), ...ins, ...hp.slice(k)];
    out.push({ text: all.join("\n\n"), human: hp.join("\n\n"), aiParas: ins.map((_, i) => k + i), paras: all, host: d, donor: don.d,
      sameTopic: !!byGroup.get(d.group) });
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

module.exports = { buildMixed, paras, goodAiPara, rng, h32 };

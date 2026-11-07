// Score every document of one test half with one detector version, in its own process (the engine keeps
// state in globals, so two versions can't share a process).
//   node tests/lib/score.js <srcDir> <dev|final> <out.json>
// Writes { docs: {key: row}, mixed: [...], reformatted: {...}, polished: [...] }.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [srcDir, half, outFile] = process.argv.slice(2);
if (!srcDir || !/^(dev|final)$/.test(half || "") || !outFile) { console.error("usage: score.js <srcDir> <dev|final> <out.json>"); process.exit(2); }
const C = require(path.resolve(srcDir, "core.js"));
const ENS = require(path.resolve(srcDir, "ensemble.js"));
const D = require("./datasets.js");
const { buildMixed } = require("./mixed.js");

const docs = D.all(); D.markLeaks(docs);
const key = d => crypto.createHash("md5").update(d.source + "|" + d.group + "|" + d.text).digest("hex").slice(0, 16);
const inHalf = d => d.split === "test" && d.half === half;
// the page's full analysis: v14+ assess() decides "mixed" itself (r.mix set); older versions add it on the page with
// core.mixedCheck, which is emulated here so the baseline is scored exactly as the page shows it
const paraIndex = (text, start) => text.slice(0, start).split(/\n\s*\n|\n/).filter(s => s.trim()).length;
const run = t => {
  const r = ENS.assess(t, { noCache: true }); if (r.tooShort) return null;
  if (!r.mix && C.mixedCheck) { const mx = C.mixedCheck(r.text, r); r.mix = mx; if (mx.mixed && r.band !== "ai") r.band = "mixed"; }
  if (r.band === "mixed" && r.mix && r.mix.para) r.mixedPara = paraIndex(r.text, r.mix.para.start);
  return r;
};
const lean = r => r.attr ? r.attr.lean : "unclear";
const row = r => ({ p: r.likelihood, band: r.band, wc: r.wc, lean: lean(r), cg: r.cutGenre || null, spec: r.specialist ? r.specialist.name : null,
  mixedPara: r.mixedPara != null ? r.mixedPara : null, conf: r.confidence || null,
  mixP: r.mix && r.mix.paras && r.mix.paras.length ? Math.max(...r.mix.paras.map(q => q.p)) : null,
  mixIdx: r.mix && r.mix.paras && r.mix.paras.length ? (() => { const b = r.mix.paras.reduce((a, q) => q.p > a.p ? q : a); return paraIndex(r.text, b.start); })() : null });

const out = { half, src: srcDir, docs: {}, mixed: {}, reformatted: {}, polished: [] };
let n = 0; const t0 = Date.now();
for (const d of docs) {
  if (!inHalf(d)) continue;
  if (d.leak && !/^ai-polished/.test(d.condition)) continue;
  if (C.nWords(C.cleanText(d.text).text) < 40) continue;
  const r = run(d.text); if (!r) continue;
  out.docs[key(d)] = { ...row(r), y: d.label === "ai" ? 1 : 0, source: d.source, model: d.model, genre: d.genre, condition: d.condition, group: d.group, length: d.length || null };
  if (++n % 2000 === 0) process.stderr.write(`  ${n} docs, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
// mixed documents: "classic" = the v8-v12 test (a same-prompt ChatGPT/Claude paragraph in the middle of a student essay),
// "broad" = any genre, random position (including first and last), one or two paragraphs, same-prompt donor when available
const classicHosts = docs.filter(d => inHalf(d) && d.source.startsWith("ghostbuster/essay") && d.condition === "original");
const byG = new Map(); for (const d of classicHosts) { if (!byG.has(d.group)) byG.set(d.group, {}); byG.get(d.group)[d.label] = d; }
const classic = [];
for (const { human, ai } of byG.values()) {
  if (!human || !ai || human.leak) continue;
  const hp = human.text.split("\n").filter(p => C.nWords(p) >= 25), ap = ai.text.split("\n").filter(p => C.nWords(p) >= 60 && C.nWords(p) <= 160 && !/:\s*$/.test(p));
  if (hp.length < 3 || !ap.length) continue;
  const k = Math.floor(hp.length / 2);
  classic.push({ text: [...hp.slice(0, k), ap[0], ...hp.slice(k)].join("\n\n"), human: hp.join("\n\n"), aiParas: [k], genre: "academic", sameTopic: true });
}
const broad = buildMixed(docs, inHalf, { seed: "mixed-" + half });
for (const [name, set] of [["classic", classic], ["broad", broad]]) {
  out.mixed[name] = set.map(m => {
    const a = run(m.text), b = run(m.human);
    return { mixed: a ? row(a) : null, human: b ? row(b) : null, aiParas: m.aiParas, nParas: m.paras ? m.paras.length : null,
      genre: m.genre || (m.host && m.host.genre), hostSource: m.host ? m.host.source : "ghostbuster/essay/human", donor: m.donor ? m.donor.model : null, sameTopic: m.sameTopic };
  });
}
// robustness: the same human texts reformatted
const fmt = { noShortLines: t => t.split("\n").filter(p => C.nWords(p) >= 25).join("\n\n"), oneParagraph: t => t.replace(/\s*\n\s*/g, " ") };
for (const [vn, fv] of Object.entries(fmt)) {
  let nn = 0, flag = 0, mixed = 0;
  for (const d of docs) {
    if (!inHalf(d) || d.leak || d.label !== "human" || d.condition !== "original") continue;
    const t = fv(d.text); if (C.nWords(t) < 40) continue;
    const r = run(t); if (!r) continue; nn++; if (r.band === "ai") flag++; if (r.band === "mixed") mixed++;
  }
  out.reformatted[vn] = { n: nn, flagged: flag, mixed };
}
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(outFile, JSON.stringify(out));
process.stderr.write(`scored ${n} docs + ${classic.length} classic / ${broad.length} broad mixed in ${out.seconds}s -> ${outFile}\n`);

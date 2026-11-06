// Benchmark the previous engine (v9 rule score) against v10 (trained ensemble) on the held-out test split.
//   node tests/benchmark.js            writes docs/benchmark.json and docs/benchmark.html
// Only test-split documents are used. Test documents that are near-copies of training documents
// (see tests/lib/datasets.js leakageReport) are skipped.
const fs = require("fs");
const path = require("path");
const C = require("../src/core.js");
const ENS = require("../src/ensemble.js");
const D = require("./lib/datasets.js");

// ---------- metrics ----------
function auc(pos, neg) {   // probability a random AI text scores above a random human text (ties count half)
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => [s, 1]).concat(neg.map(s => [s, 0])).sort((a, b) => a[0] - b[0]);
  let rank = 0, sumPos = 0;
  for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sumPos += r; i = j; }
  return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
function prAuc(pos, neg) {  // average precision
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => [s, 1]).concat(neg.map(s => [s, 0])).sort((a, b) => b[0] - a[0]);
  let tp = 0, fp = 0, ap = 0;
  for (const [, y] of all) { if (y) { tp++; ap += tp / (tp + fp); } else fp++; }
  return ap / pos.length;
}
function ece(probs, ys, bins = 10) {  // expected calibration error (equal-width bins, classes balanced)
  const nA = ys.filter(y => y).length, nH = ys.length - nA; if (!nA || !nH) return null;
  const B = Array.from({ length: bins }, () => ({ w: 0, p: 0, y: 0 }));
  probs.forEach((p, i) => { const b = B[Math.min(bins - 1, Math.floor(p * bins))]; const w = ys[i] ? 0.5 / nA : 0.5 / nH; b.w += w; b.p += w * p; b.y += w * ys[i]; });
  return B.reduce((a, b) => a + (b.w ? Math.abs(b.p - b.y) : 0), 0);
}
function metrics(rows, sys) {
  const H = rows.filter(r => !r.y), A = rows.filter(r => r.y);
  const tp = A.filter(r => r[sys].flag).length, fp = H.filter(r => r[sys].flag).length, fn = A.length - tp, tn = H.length - fp;
  const prec = tp + fp ? tp / (tp + fp) : null, rec = A.length ? tp / A.length : null;
  return {
    n_human: H.length, n_ai: A.length, accuracy: (tp + tn) / Math.max(1, rows.length), precision: prec, recall: rec,
    f1: prec != null && rec != null && prec + rec ? 2 * prec * rec / (prec + rec) : null,
    fpr: H.length ? fp / H.length : null, fnr: A.length ? fn / A.length : null, fp, tp,
    inconclusive_human: H.length ? H.filter(r => r[sys].band === "inconclusive" || r[sys].band === "edited").length / H.length : null,
    roc_auc: auc(A.map(r => r[sys].score), H.map(r => r[sys].score)), pr_auc: prAuc(A.map(r => r[sys].score), H.map(r => r[sys].score)),
    ece: ece(rows.map(r => r[sys].score / 100), rows.map(r => r.y))
  };
}

// ---------- score every test document with both systems ----------
function scoreDocs() {
  const docs = D.all(); const leaks = D.markLeaks(docs);
  const rows = [];
  for (const d of docs) {
    if (d.split !== "test" || d.leak) continue;
    const text = C.cleanText(d.text).text;
    if (C.nWords(text) < 40) continue;
    const v9 = C.analyze(text);
    const v10 = ENS.assess(d.text, { noCache: true });
    const fam = /claude/.test(d.model) ? "claude" : /gpt|chatgpt/.test(d.model) ? "chatgpt" : null;
    rows.push({ y: d.label === "ai" ? 1 : 0, d, fam, attr9: C.attribute(text, v9).lean, attr10: v10.attr ? v10.attr.lean : "unclear",
      v9: { score: v9.score, band: v9.band, flag: v9.score >= C.BANDS.ai || v9.band === "ai" },
      v10: { score: v10.likelihood, band: v10.band, flag: v10.band === "ai", genre: v10.genre, conf: v10.confidence } });
  }
  return { rows, leaks };
}

// mixed-origin documents: a test-split human essay with one AI paragraph (same prompt) pasted in the middle
function mixedDocs() {
  const docs = D.all().filter(d => d.split === "test" && d.genre === "academic" && d.condition === "original" && d.source.startsWith("ghostbuster/essay"));
  const byGroup = new Map(); for (const d of docs) { if (!byGroup.has(d.group)) byGroup.set(d.group, {}); byGroup.get(d.group)[d.label === "ai" ? "ai" : "human"] = d; }
  const out = [];
  for (const { human, ai } of byGroup.values()) {
    if (!human || !ai) continue;
    const hp = human.text.split("\n").filter(p => C.nWords(p) >= 25), ap = ai.text.split("\n").filter(p => C.nWords(p) >= 60 && C.nWords(p) <= 160 && !/:\s*$/.test(p));
    if (hp.length < 3 || !ap.length) continue;
    const k = Math.floor(hp.length / 2);
    out.push({ mixed: [...hp.slice(0, k), ap[0], ...hp.slice(k)].join("\n\n"), human: hp.join("\n\n") });
  }
  return out;
}
function mixedResult(text) {
  const v9 = C.analyze(C.cleanText(text).text), t = C.cleanText(text).text;
  const v9mixed = v9.band === "ai" || C.mixedCheck(t, v9).mixed;
  const r = ENS.assess(text, { noCache: true });
  const v10mixed = r.band === "ai" || (r.band !== "ai" && C.mixedCheck(t, C.analyze(t)).mixed);
  return { v9: v9mixed, v10: v10mixed };
}

// ---------- slices ----------
function slices(rows) {
  const human = g => rows.filter(r => !r.y && g(r.d)), ai = g => rows.filter(r => r.y && g(r.d));
  const orig = d => d.condition === "original";
  const S = [];
  const add = (name, H, A, note) => S.push({ name, rows: H.concat(A), note });
  // the categories from the brief
  add("Human academic (student + university essays) vs AI essays", human(d => d.genre === "academic"), ai(d => d.genre === "academic" && orig(d)));
  add("Human creative (Reddit stories) vs AI stories", human(d => d.genre === "creative"), ai(d => d.genre === "creative" && orig(d)));
  add("Human journalism (Reuters) vs AI news", human(d => d.genre === "news" && orig(d)), ai(d => d.genre === "news" && orig(d)));
  add("English-learner essays (human only)", human(d => d.genre === "learner"), []);
  add("Humanised AI news (undetectable.ai) vs Reuters", human(d => d.genre === "news" && orig(d)), ai(d => d.condition === "humaniser"));
  add("AI written with other prompts (prompt variants) vs same-genre humans", human(d => ["academic", "creative", "news"].includes(d.genre)), ai(d => d.condition === "prompt-variant" && d.source.startsWith("ghostbuster")));
  add("Contemporary Claude Opus 5.5 (held out) vs all humans", human(() => true).filter(r => r.d.condition === "original"), ai(d => d.model === "claude-opus-5.5" && orig(d)));
  add("Opus 5.5 edited to sound like a student (simulated)", [], ai(d => d.condition === "human-edited-simulated"));
  add("GPTZero comparison set (ChatGPT vs human)", human(d => d.source.includes("gptzero")), ai(d => d.source.includes("gptzero")));
  // per model family (original condition), against all original human texts
  for (const m of ["gpt-3.5-turbo", "claude-2023", "claude-opus-5.5", "claude-imitation", "chatgpt-imitation", "chatgpt-unknown"]) {
    const A = ai(d => d.model === m && orig(d)); if (A.length) add(`Model family: ${m}`, human(d => d.condition === "original"), A);
  }
  // editing conditions (perturbations of news documents; humans perturbed the same way)
  const conds = [...new Set(rows.map(r => r.d.condition).filter(c => c.includes("@")))].sort();
  for (const c of conds) add(`Edited: ${c.replace("@", " x")}`, human(d => d.condition === c), ai(d => d.condition === c));
  return S;
}

function main() {
  const t0 = Date.now();
  const { rows, leaks } = scoreDocs();
  const overallRows = rows.filter(r => r.d.condition === "original" || r.d.condition === "prompt-variant" || r.d.condition === "humaniser");
  const report = { generated: new Date().toISOString(), docs: rows.length, skippedLeaks: leaks,
    overall: { v9: metrics(overallRows, "v9"), v10: metrics(overallRows, "v10"), n: overallRows.length }, slices: [] };
  for (const s of slices(rows)) if (s.rows.length) report.slices.push({ name: s.name, v9: metrics(s.rows, "v9"), v10: metrics(s.rows, "v10") });
  // human false positives by source (the most important table)
  const bySrc = {};
  for (const r of rows.filter(r => !r.y && r.d.condition === "original")) { const k = r.d.source; bySrc[k] = bySrc[k] || { n: 0, v9: 0, v10: 0 }; bySrc[k].n++; if (r.v9.flag) bySrc[k].v9++; if (r.v10.flag) bySrc[k].v10++; }
  report.humanFalsePositives = bySrc;
  const mixed = mixedDocs(); let m9 = 0, m10 = 0, h9 = 0, h10 = 0;
  for (const m of mixed) { const a = mixedResult(m.mixed), b = mixedResult(m.human); if (a.v9) m9++; if (a.v10) m10++; if (b.v9) h9++; if (b.v10) h10++; }
  report.mixed = { n: mixed.length, flagged_v9: m9, flagged_v10: m10, same_essay_without_ai_paragraph_v9: h9, same_essay_without_ai_paragraph_v10: h10 };
  // attribution: which family (Claude vs ChatGPT) on AI texts with a known family
  const at = {};
  // only texts the system didn't call "likely human" (it doesn't name a model for those)
  for (const r of rows.filter(r => r.y && r.fam && !r.d.condition.includes("@") && r.v10.band !== "human")) {
    const k = r.d.model + (r.d.condition === "original" ? "" : " (" + r.d.condition + ")");
    const o = at[k] = at[k] || { family: r.fam, n: 0, v9: { right: 0, wrong: 0, unclear: 0 }, v10: { right: 0, wrong: 0, unclear: 0 } };
    o.n++;
    for (const [sys, lean] of [["v9", r.attr9], ["v10", r.attr10]]) o[sys][lean === "unclear" ? "unclear" : lean === r.fam ? "right" : "wrong"]++;
  }
  report.attribution = at;
  report.seconds = Math.round((Date.now() - t0) / 1000);
  const dir = path.join(__dirname, "../docs"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "benchmark.json"), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(dir, "benchmark.html"), html(report));
  const f = (x, d = 1) => x == null ? "–" : (x * 100).toFixed(d) + "%";
  const a = x => x == null ? "–" : x.toFixed(3);
  console.log(`test docs: ${rows.length} (skipped ${leaks} near-copies of training docs) in ${report.seconds}s`);
  console.log(`OVERALL (original + prompt variants + humaniser): v9 recall ${f(report.overall.v9.recall)} FPR ${f(report.overall.v9.fpr, 2)} AUC ${a(report.overall.v9.roc_auc)} | v10 recall ${f(report.overall.v10.recall)} FPR ${f(report.overall.v10.fpr, 2)} AUC ${a(report.overall.v10.roc_auc)}`);
  for (const s of report.slices) console.log(`${s.name.slice(0, 62).padEnd(62)} v9 rec ${f(s.v9.recall).padStart(6)} FPR ${f(s.v9.fpr, 2).padStart(6)} AUC ${a(s.v9.roc_auc)} | v10 rec ${f(s.v10.recall).padStart(6)} FPR ${f(s.v10.fpr, 2).padStart(6)} AUC ${a(s.v10.roc_auc)}`);
  console.log("human false positives by source:", Object.entries(bySrc).map(([k, v]) => `${k.replace("ghostbuster/", "")} ${v.v9}→${v.v10}/${v.n}`).join(", "));
  console.log("mixed:", report.mixed);
  for (const [k, o] of Object.entries(at)) console.log(`attribution ${k.padEnd(40)} n ${String(o.n).padStart(5)} | v9 right ${f(o.v9.right / o.n)} wrong ${f(o.v9.wrong / o.n)} | v11 right ${f(o.v10.right / o.n)} wrong ${f(o.v10.wrong / o.n)}`);
}

function html(R) {
  const f = (x, d = 1) => x == null ? "–" : (x * 100).toFixed(d) + "%";
  const a = x => x == null ? "–" : x.toFixed(3);
  const cls = (newer, older, lowerBetter) => newer == null || older == null || Math.abs(newer - older) < 0.005 ? "" : (lowerBetter ? newer < older : newer > older) ? "up" : "down";
  const row = (name, s) => `<tr><td>${name}</td><td class="n">${s.v10.n_human}</td><td class="n">${s.v10.n_ai}</td>
    <td class="n">${f(s.v9.recall)}</td><td class="n ${cls(s.v10.recall, s.v9.recall)}">${f(s.v10.recall)}</td>
    <td class="n">${f(s.v9.fpr, 2)}</td><td class="n ${cls(s.v10.fpr, s.v9.fpr, true)}">${f(s.v10.fpr, 2)}</td>
    <td class="n">${a(s.v9.roc_auc)}</td><td class="n ${cls(s.v10.roc_auc, s.v9.roc_auc)}">${a(s.v10.roc_auc)}</td>
    <td class="n">${a(s.v9.f1)}</td><td class="n ${cls(s.v10.f1, s.v9.f1)}">${a(s.v10.f1)}</td>
    <td class="n">${a(s.v9.pr_auc)}</td><td class="n ${cls(s.v10.pr_auc, s.v9.pr_auc)}">${a(s.v10.pr_auc)}</td>
    <td class="n">${a(s.v9.ece)}</td><td class="n ${cls(s.v10.ece, s.v9.ece, true)}">${a(s.v10.ece)}</td></tr>`;
  const O = R.overall;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Detector Benchmark</title>
<style>:root{--bg:#f6f5f1;--card:#fff;--ink:#1c1c1a;--muted:#6b6a63;--line:#e3e1d9;--up:#2f7d5b;--down:#c0392b}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141413;--card:#1d1d1b;--ink:#ecebe5;--muted:#9b9a90;--line:#33322e;--up:#4fbf8f;--down:#ef6a5b}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:5px 7px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}td:first-child{white-space:normal;min-width:240px}
th{color:var(--muted);font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}.up{color:var(--up);font-weight:700}.down{color:var(--down);font-weight:700}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.kpi b{display:block;font-size:1.6rem}.muted{color:var(--muted)}</style></head><body><main>
<h1>Detector benchmark: v9 rules vs v11 ensemble</h1>
<p class="muted">Held-out test split only (${R.docs.toLocaleString()} documents; ${R.skippedLeaks} near-copies of training documents skipped). Generated ${R.generated.slice(0, 10)}. "Recall" = share of AI texts flagged AI-leaning; "FPR" = share of human texts wrongly flagged. AUC is threshold-free (1.0 perfect, 0.5 coin toss). Green = better than v9. Columns labelled v10 show the current engine (v11).</p>
<div class="card kpis">
<div class="kpi"><span class="muted">AI caught (overall)</span><b>${f(O.v9.recall)} → ${f(O.v10.recall)}</b></div>
<div class="kpi"><span class="muted">Humans wrongly flagged</span><b>${f(O.v9.fpr, 2)} → ${f(O.v10.fpr, 2)}</b></div>
<div class="kpi"><span class="muted">ROC-AUC</span><b>${a(O.v9.roc_auc)} → ${a(O.v10.roc_auc)}</b></div>
<div class="kpi"><span class="muted">Calibration error</span><b>${a(O.v9.ece)} → ${a(O.v10.ece)}</b></div>
<div class="kpi"><span class="muted">Mixed essays spotted</span><b>${R.mixed.flagged_v9} → ${R.mixed.flagged_v10} of ${R.mixed.n}</b></div></div>
<div class="card wrap"><table><tr><th>Slice</th><th class="n">Human</th><th class="n">AI</th><th class="n">Recall v9</th><th class="n">v10</th><th class="n">FPR v9</th><th class="n">v10</th><th class="n">AUC v9</th><th class="n">v10</th><th class="n">F1 v9</th><th class="n">v10</th><th class="n">PR-AUC v9</th><th class="n">v10</th><th class="n">ECE v9</th><th class="n">v10</th></tr>
${row("<b>Overall</b> (original, prompt variants, humaniser)", O)}${R.slices.map(s => row(s.name, s)).join("")}</table></div>
<div class="card"><h2>Human false positives by source</h2><div class="wrap"><table><tr><th>Source</th><th class="n">Texts</th><th class="n">v9 flagged</th><th class="n">v10 flagged</th></tr>
${Object.entries(R.humanFalsePositives).map(([k, v]) => `<tr><td>${k}</td><td class="n">${v.n}</td><td class="n">${v.v9}</td><td class="n ${cls(v.v10, v.v9, true)}">${v.v10}</td></tr>`).join("")}</table></div></div>
<div class="card"><h2>Which AI? (Claude vs ChatGPT attribution)</h2><div class="wrap"><table><tr><th>AI texts</th><th class="n">Texts</th><th class="n">Right v9</th><th class="n">v11</th><th class="n">Wrong v9</th><th class="n">v11</th><th class="n">Can't tell v9</th><th class="n">v11</th></tr>
${Object.entries(R.attribution || {}).map(([k, o]) => `<tr><td>${k}</td><td class="n">${o.n}</td><td class="n">${f(o.v9.right / o.n)}</td><td class="n ${cls(o.v10.right / o.n, o.v9.right / o.n)}">${f(o.v10.right / o.n)}</td><td class="n">${f(o.v9.wrong / o.n)}</td><td class="n ${cls(o.v10.wrong / o.n, o.v9.wrong / o.n, true)}">${f(o.v10.wrong / o.n)}</td><td class="n">${f(o.v9.unclear / o.n)}</td><td class="n">${f(o.v10.unclear / o.n)}</td></tr>`).join("")}</table></div>
<p class="muted">Counted on AI texts that v11 did not call "likely human" (it doesn't name a model for those). "chatgpt-imitation" texts were written by Claude imitating ChatGPT, so "Claude" is arguably the right answer for them.</p></div>
<div class="card"><h2>Mixed-origin essays</h2><p>${R.mixed.n} held-out student essays with one AI paragraph (same prompt) pasted into the middle. Flagged as Mixed or AI-leaning: v9 ${R.mixed.flagged_v9}, v10 ${R.mixed.flagged_v10}. The same essays without the AI paragraph: v9 ${R.mixed.same_essay_without_ai_paragraph_v9}, v10 ${R.mixed.same_essay_without_ai_paragraph_v10}.</p></div>
<p class="muted">Limits: AI texts are mostly gpt-3.5-turbo and Claude (2023); contemporary coverage is 54 Claude Opus 5.5 texts. No GPT-5/6, Gemini, DeepSeek or Llama samples were available. Edited-text conditions are Ghostbuster's automatic perturbations of news articles.</p>
</main></body></html>`;
}

if (require.main === module) main();
module.exports = { metrics, auc, prAuc, ece };

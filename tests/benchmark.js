// v14 benchmark: compares the current detector (src/) with the frozen v12.3 baseline (tests/baselines/v12.3) on one
// half of the held-out test data.
//
//   node tests/benchmark.js                 dev half (use this for every decision)  -> docs/benchmark-dev.json / .html
//   CONFIRM_FINAL=yes node tests/benchmark.js --final
//                                           sealed final half -> docs/benchmark.json / .html, and appends a line to
//                                           docs/final-runs.md (date, model hash, headline numbers). Run it once per release.
//
// Test documents are split into dev / final by a hash of their group (tests/lib/datasets.js sealSplit), so a prompt's
// human and AI texts always sit in the same half. Test documents that are near-copies of training documents are skipped.
// Every proportion has a 95% Wilson interval; ROC-AUC has a 95% Hanley-McNeil interval.
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const half = args.includes("--final") ? "final" : "dev";
if (half === "final" && process.env.CONFIRM_FINAL !== "yes") {
  console.error("The final half is sealed. Run it only to report a finished release:\n  CONFIRM_FINAL=yes node tests/benchmark.js --final");
  process.exit(2);
}
const baseDir = (args.find(a => a.startsWith("--baseline=")) || "").split("=")[1] || path.join(__dirname, "baselines/v12.3");
const curDir = (args.find(a => a.startsWith("--src=")) || "").split("=")[1] || path.join(__dirname, "../src");
const CACHE = path.join(__dirname, ".cache"); fs.mkdirSync(CACHE, { recursive: true });

// ---------- scoring (each system in its own process, cached by the hash of its code + model + data) ----------
function dirHash(dir) {
  const h = crypto.createHash("md5");
  for (const f of ["core.js", "stats.js", "ensemble.js", "model.json"]) h.update(fs.readFileSync(path.join(dir, f)));
  for (const f of ["lib/datasets.js", "lib/mixed.js", "lib/score.js"]) h.update(fs.readFileSync(path.join(__dirname, f)));
  return h.digest("hex").slice(0, 12);
}
function dataHash() {   // file names + sizes of every data source, so new data invalidates the cache
  const h = crypto.createHash("md5"), root = path.join(__dirname, "data");
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "logprobs") walk(p); } else h.update(p + fs.statSync(p).size); } };
  walk(root); return h.digest("hex").slice(0, 12);
}
function scores(dir, label) {
  const f = path.join(CACHE, `scores_${half}_${dirHash(dir)}_${dataHash()}.json`);
  if (!fs.existsSync(f)) { console.error(`scoring ${label} (${dir}) on the ${half} half...`); execFileSync(process.execPath, [path.join(__dirname, "lib/score.js"), dir, half, f], { stdio: "inherit", maxBuffer: 1 << 26 }); }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

// ---------- statistics ----------
function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = pos.map(s => [s, 1]).concat(neg.map(s => [s, 0])).sort((a, b) => a[0] - b[0]);
  let sumPos = 0;
  for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) sumPos += r; i = j; }
  return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
function aucCI(A, nP, nN) {   // Hanley & McNeil (1982)
  if (A == null) return [null, null];
  const q1 = A / (2 - A), q2 = 2 * A * A / (1 + A), se = Math.sqrt((A * (1 - A) + (nP - 1) * (q1 - A * A) + (nN - 1) * (q2 - A * A)) / (nP * nN));
  return [Math.max(0, A - 1.96 * se), Math.min(1, A + 1.96 * se)];
}
function prCurve(pos, neg) {  // precision at each recall level (scores are 0-100 likelihoods), plus average precision
  const all = pos.map(s => [s, 1]).concat(neg.map(s => [s, 0])).sort((a, b) => b[0] - a[0]);
  let tp = 0, fp = 0, ap = 0; const pts = [];
  for (let i = 0; i < all.length; i++) { if (all[i][1]) { tp++; ap += tp / (tp + fp); } else fp++;
    if (i === all.length - 1 || all[i + 1][0] !== all[i][0]) pts.push([+(tp / pos.length).toFixed(4), +(tp / (tp + fp)).toFixed(4), all[i][0]]); }
  const keep = []; let last = -1; for (const p of pts) if (p[0] - last >= 0.01 || p === pts[pts.length - 1]) { keep.push(p); last = p[0]; }
  return { ap: pos.length ? ap / pos.length : null, points: keep };
}
const brier = (ps, ys) => ps.length ? ps.reduce((a, p, i) => a + (p - ys[i]) ** 2, 0) / ps.length : null;
function ece(ps, ys, bins = 10) {  // classes balanced, so the base rate of this test mix doesn't drive the number
  const nA = ys.filter(y => y).length, nH = ys.length - nA; if (!nA || !nH) return { ece: null, bins: [] };
  const B = Array.from({ length: bins }, () => ({ w: 0, p: 0, y: 0, n: 0 }));
  ps.forEach((p, i) => { const b = B[Math.min(bins - 1, Math.floor(p * bins))]; const w = ys[i] ? 0.5 / nA : 0.5 / nH; b.w += w; b.p += w * p; b.y += w * ys[i]; b.n++; });
  return { ece: B.reduce((a, b) => a + (b.w ? Math.abs(b.p - b.y) : 0), 0), bins: B.map((b, i) => ({ from: i / bins, n: b.n, meanP: b.w ? b.p / b.w : null, fracAI: b.w ? b.y / b.w : null })) };
}
function metrics(rows) {
  const H = rows.filter(r => !r.y), A = rows.filter(r => r.y);
  const fp = H.filter(r => r.band === "ai").length, tp = A.filter(r => r.band === "ai").length;
  const prec = tp + fp ? tp / (tp + fp) : null, rec = A.length ? tp / A.length : null;
  const roc = auc(A.map(r => r.p), H.map(r => r.p));
  const ps = rows.map(r => r.p / 100), ys = rows.map(r => r.y);
  const cal = ece(ps, ys);
  return {
    n_human: H.length, n_ai: A.length, tp, fp, fn: A.length - tp, tn: H.length - fp,
    recall: rec, recall_ci: wilson(tp, A.length), fpr: H.length ? fp / H.length : null, fpr_ci: wilson(fp, H.length),
    precision: prec, precision_ci: wilson(tp, tp + fp), f1: prec != null && rec != null && prec + rec ? 2 * prec * rec / (prec + rec) : null,
    accuracy: rows.length ? (tp + H.length - fp) / rows.length : null,
    inconclusive_human: H.length ? H.filter(r => r.band === "inconclusive" || r.band === "edited").length / H.length : null,
    mixed_human: H.length ? H.filter(r => r.band === "mixed").length / H.length : null,
    roc_auc: roc, roc_auc_ci: aucCI(roc, A.length, H.length), pr: prCurve(A.map(r => r.p), H.map(r => r.p)),
    brier: brier(ps, ys), ece: cal.ece, reliability: cal.bins
  };
}
const lite = m => { const { pr, reliability, ...rest } = m; return { ...rest, pr_auc: pr ? pr.ap : null }; };

// ---------- report ----------
function report(S) {
  const rows = Object.values(S.docs);
  const CORE = r => !/^(detectrl|outfox|claude_indep|ai_polished)/.test(r.source);
  const orig = r => r.condition === "original";
  const overallCore = rows.filter(r => CORE(r) && (orig(r) || r.condition === "prompt-variant" || r.condition === "humaniser"));
  const humansAll = rows.filter(r => !r.y && orig(r));
  const R = { overall_core: metrics(overallCore), slices: {}, humanFP: {}, byLength: {}, byGenreFP: {}, mixed: {}, reformatted: S.reformatted, attribution: {} };
  const add = (name, H, A) => { if (H.length + A.length) R.slices[name] = lite(metrics(H.concat(A))); };
  const coreH = rows.filter(r => CORE(r) && !r.y && orig(r));
  // core slices (comparable with v10-v12 reports)
  add("Essays: student + university vs AI essays", coreH.filter(r => r.genre === "academic"), rows.filter(r => CORE(r) && r.y && orig(r) && r.genre === "academic"));
  add("Stories: Reddit vs AI stories", coreH.filter(r => r.genre === "creative"), rows.filter(r => CORE(r) && r.y && orig(r) && r.genre === "creative"));
  add("News: Reuters vs AI news", coreH.filter(r => r.genre === "news"), rows.filter(r => CORE(r) && r.y && orig(r) && r.genre === "news"));
  add("Humaniser-tool AI news vs Reuters", coreH.filter(r => r.genre === "news"), rows.filter(r => r.condition === "humaniser"));
  add("Opus 5.5 written in this project (opus55/)", coreH, rows.filter(r => r.y && r.model === "claude-opus-5.5" && r.source.startsWith("opus55") && orig(r)));
  add("Opus 5.5 edited to sound like a student (simulated)", [], rows.filter(r => r.condition === "human-edited-simulated"));
  for (const m of ["gpt-3.5-turbo", "claude-2023"]) add(`Ghostbuster ${m}`, coreH, rows.filter(r => CORE(r) && r.y && r.model === m && orig(r)));
  // independent Claude set (helper sessions with no detector context)
  const ci = rows.filter(r => r.source.startsWith("claude_indep"));
  add("INDEPENDENT Claude (Opus + Sonnet + Haiku 5.5, no detector context) vs all humans", coreH, ci);
  for (const m of ["claude-opus-5.5", "claude-sonnet-5.5", "claude-haiku-5.5"]) add(`INDEPENDENT ${m}`, coreH, ci.filter(r => r.model === m));
  for (const l of ["short", "medium", "long"]) add(`INDEPENDENT Claude, ${l} requests`, coreH, ci.filter(r => r.length === l));
  for (const g of ["academic", "creative", "conversational", "explanation", "news", "other"]) add(`INDEPENDENT Claude, ${g}`, coreH, ci.filter(r => r.genre === g));
  // DetectRL (independent benchmark, other model families)
  const drl = rows.filter(r => r.source.startsWith("detectrl")), drlH = drl.filter(r => !r.y && orig(r));
  add("DetectRL humans (arXiv, XSum, WritingPrompts, Yelp) vs DetectRL AI (all original)", drlH, drl.filter(r => r.y && orig(r)));
  for (const m of ["gpt-3.5-turbo", "claude-instant", "palm-2", "llama-2-70b"]) add(`DetectRL ${m} (direct prompt)`, drlH, drl.filter(r => r.y && orig(r) && r.model === m));
  for (const c of [...new Set(drl.map(r => r.condition))].filter(c => c !== "original").sort()) add(`DetectRL ${c}`, drl.filter(r => !r.y && (orig(r) || r.condition === c)), drl.filter(r => r.y && r.condition === c));
  for (const g of ["academic", "news", "creative", "other"]) add(`DetectRL ${g}`, drlH.filter(r => r.genre === g), drl.filter(r => r.y && orig(r) && r.genre === g));
  // OUTFOX (US grade 6-12 student essays)
  const ofx = rows.filter(r => r.source.startsWith("outfox")), ofxH = ofx.filter(r => !r.y);
  for (const s of ["outfox/gpt-3.5-turbo", "outfox/text-davinci-003", "outfox/flan-t5-xxl", "outfox/gpt-3.5-turbo/dipper-paraphrase", "outfox/gpt-3.5-turbo/outfox-attack"]) add(`OUTFOX student essays vs ${s.slice(7)}`, ofxH, ofx.filter(r => r.source === s));
  // perturbation / paraphrase sets from Ghostbuster
  for (const c of [...new Set(rows.map(r => r.condition))].filter(c => c.includes("@")).sort()) add(`Ghostbuster edited: ${c.replace("@", " x")}`, rows.filter(r => !r.y && r.condition === c), rows.filter(r => r.y && r.condition === c));
  // AI-assisted human text: never counted as AI, reported separately (how often the detector calls it AI)
  for (const c of ["ai-polished-light", "ai-polished-heavy", "ai-polished-human"]) {
    const P = rows.filter(r => r.condition === c); if (!P.length) continue;
    const f = P.filter(r => r.band === "ai").length; R.slices[`AI-assisted human text: ${c}`] = { n: P.length, flagged_ai: f, rate: f / P.length, rate_ci: wilson(f, P.length), mean_p: P.reduce((a, r) => a + r.p, 0) / P.length };
  }
  // human false positives: by source, by genre, by length
  for (const r of humansAll) { const k = r.source; R.humanFP[k] = R.humanFP[k] || { n: 0, fp: 0, inconclusive: 0, mixed: 0 }; R.humanFP[k].n++; if (r.band === "ai") R.humanFP[k].fp++; if (r.band === "inconclusive") R.humanFP[k].inconclusive++; if (r.band === "mixed") R.humanFP[k].mixed++; }
  for (const k in R.humanFP) R.humanFP[k].fpr_ci = wilson(R.humanFP[k].fp, R.humanFP[k].n);
  for (const r of humansAll) { const k = r.genre; R.byGenreFP[k] = R.byGenreFP[k] || { n: 0, fp: 0 }; R.byGenreFP[k].n++; if (r.band === "ai") R.byGenreFP[k].fp++; }
  for (const k in R.byGenreFP) R.byGenreFP[k].fpr_ci = wilson(R.byGenreFP[k].fp, R.byGenreFP[k].n);
  const LB = [["under 150 words", 0, 150], ["150-299", 150, 300], ["300-599", 300, 600], ["600+", 600, 1e9]];
  for (const [name, lo, hi] of LB) { const sel = overallCore.concat(ci).filter(r => r.wc >= lo && r.wc < hi); R.byLength[name] = lite(metrics(sel)); }
  // mixed documents
  for (const [name, set] of Object.entries(S.mixed)) {
    const ok = set.filter(m => m.mixed && m.human);
    const mixedTP = ok.filter(m => m.mixed.band === "mixed").length, anyTP = ok.filter(m => m.mixed.band === "mixed" || m.mixed.band === "ai").length;
    const humFalseMixed = ok.filter(m => m.human.band === "mixed").length, humFalseAny = ok.filter(m => m.human.band === "mixed" || m.human.band === "ai").length;
    const locOK = ok.filter(m => m.mixed.band === "mixed" && m.mixed.mixedPara != null && m.aiParas.includes(m.mixed.mixedPara)).length;
    R.mixed[name] = { n: ok.length, mixed_recall: mixedTP / ok.length, mixed_recall_ci: wilson(mixedTP, ok.length), flagged_recall: anyTP / ok.length, flagged_recall_ci: wilson(anyTP, ok.length),
      host_false_mixed: humFalseMixed, host_false_mixed_rate: humFalseMixed / ok.length, host_false_mixed_ci: wilson(humFalseMixed, ok.length), host_false_any: humFalseAny,
      mixed_precision_balanced: mixedTP + humFalseMixed ? mixedTP / (mixedTP + humFalseMixed) : null, located_correctly: locOK, located_rate: mixedTP ? locOK / mixedTP : null,
      byGenre: Object.fromEntries([...new Set(ok.map(m => m.genre))].map(g => { const s = ok.filter(m => m.genre === g); return [g, { n: s.length, mixed: s.filter(m => m.mixed.band === "mixed").length, flagged: s.filter(m => m.mixed.band === "mixed" || m.mixed.band === "ai").length, host_false_mixed: s.filter(m => m.human.band === "mixed").length }]; })) };
  }
  // sentence-level mixing (DetectRL): mostly-human text with AI sentences swapped in
  const mh = rows.filter(r => r.condition === "mixed-sentences-mostly-human");
  if (mh.length) { const k = mh.filter(r => r.band === "mixed").length, kk = mh.filter(r => r.band === "mixed" || r.band === "ai").length;
    R.mixed["DetectRL sentence-level (mostly human)"] = { n: mh.length, mixed_recall: k / mh.length, mixed_recall_ci: wilson(k, mh.length), flagged_recall: kk / mh.length, flagged_recall_ci: wilson(kk, mh.length),
      host_false_mixed: drlH.filter(r => r.band === "mixed").length, host_false_mixed_rate: drlH.length ? drlH.filter(r => r.band === "mixed").length / drlH.length : null }; }
  // false "mixed" on every real human document
  R.human_false_mixed = { n: humansAll.length, mixed: humansAll.filter(r => r.band === "mixed").length };
  R.human_false_mixed.ci = wilson(R.human_false_mixed.mixed, R.human_false_mixed.n);
  // attribution: when a model is named
  const fam = m => /claude/.test(m) ? "claude" : /gpt|chatgpt|davinci/.test(m) ? "chatgpt" : null;
  for (const r of rows.filter(r => r.y && r.band !== "human" && fam(r.model))) {
    const k = r.source.startsWith("claude_indep") ? "independent " + r.model : r.model + (r.source.startsWith("detectrl") ? " (DetectRL)" : r.source.startsWith("outfox") ? " (OUTFOX)" : "");
    const A = R.attribution[k] = R.attribution[k] || { family: fam(r.model), n: 0, right: 0, wrong: 0, unclear: 0 };
    A.n++; if (r.lean === "unclear" || !r.lean) A.unclear++; else if (r.lean === A.family) A.right++; else A.wrong++;
  }
  return R;
}

function main() {
  const t0 = Date.now();
  const B = scores(baseDir, "baseline v12.3"), Cu = scores(curDir, "current");
  const out = { generated: new Date().toISOString(), half, baseline: report(B), current: report(Cu), seconds: Math.round((Date.now() - t0) / 1000),
    modelHash: crypto.createHash("md5").update(fs.readFileSync(path.join(curDir, "model.json"))).digest("hex").slice(0, 12) };
  const stem = half === "final" ? "benchmark" : "benchmark-dev";
  fs.writeFileSync(path.join(__dirname, `../docs/${stem}.json`), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, `../docs/${stem}.html`), html(out));
  if (half === "final") {
    const o = out.current.overall_core, ci = out.current.slices["INDEPENDENT Claude (Opus + Sonnet + Haiku 5.5, no detector context) vs all humans"], mx = out.current.mixed.broad;
    const line = `| ${out.generated.slice(0, 16)} | ${out.modelHash} | ${o.fp}/${o.n_human} | ${(o.recall * 100).toFixed(1)}% | ${o.roc_auc.toFixed(4)} | ${ci ? (ci.recall * 100).toFixed(1) + "%" : "-"} | ${mx ? (mx.mixed_recall * 100).toFixed(1) + "% / " + mx.host_false_mixed : "-"} |\n`;
    const f = path.join(__dirname, "../docs/final-runs.md");
    if (!fs.existsSync(f)) fs.writeFileSync(f, "# Sealed final-half runs\n\nEvery run of `CONFIRM_FINAL=yes node tests/benchmark.js --final` is logged here automatically. The final half is never used for tuning.\n\n| Date (UTC) | Model hash | Humans flagged | AI caught (core) | ROC-AUC | Independent Claude caught | Mixed recall / hosts falsely mixed |\n|---|---|---|---|---|---|---|\n");
    fs.appendFileSync(f, line);
  }
  summary(out);
}

function pct(x, d = 1) { return x == null ? "-" : (x * 100).toFixed(d) + "%"; }
function ciS(c, d = 1) { return c && c[0] != null ? `[${(c[0] * 100).toFixed(d)}, ${(c[1] * 100).toFixed(d)}]` : ""; }
function summary(out) {
  const b = out.baseline, c = out.current;
  console.log(`\n=== ${out.half.toUpperCase()} half: v12.3 baseline -> current ===`);
  const o = (k, f = pct) => console.log(`${k.padEnd(28)} ${f(b.overall_core[k])}  ->  ${f(c.overall_core[k])}`);
  console.log(`core humans flagged          ${b.overall_core.fp}/${b.overall_core.n_human}  ->  ${c.overall_core.fp}/${c.overall_core.n_human}`);
  o("recall"); o("precision", x => pct(x, 2)); o("roc_auc", x => x.toFixed(4)); o("brier", x => x.toFixed(4)); o("ece", x => x.toFixed(4)); o("inconclusive_human");
  console.log("human FP by source (only where any):");
  for (const k of Object.keys(c.humanFP).sort()) { const x = b.humanFP[k] || { fp: 0 }, y = c.humanFP[k]; if (x.fp || y.fp || x.mixed || y.mixed) console.log(`  ${k.padEnd(34)} fp ${x.fp} -> ${y.fp}   mixed ${x.mixed || 0} -> ${y.mixed} / ${y.n}${y.fp > x.fp ? "   <-- WORSE" : ""}`); }
  console.log("slices (recall, humans flagged):");
  for (const k of Object.keys(c.slices)) { const x = b.slices[k] || {}, y = c.slices[k]; if (y.recall != null) console.log(`  ${k.slice(0, 74).padEnd(74)} ${pct(x.recall)} -> ${pct(y.recall)}  fp ${x.fp} -> ${y.fp}  n=${y.n_ai}`); else if (y.rate != null) console.log(`  ${k.slice(0, 74).padEnd(74)} called AI ${pct(x.rate)} -> ${pct(y.rate)}  n=${y.n}`); }
  console.log("mixed:");
  for (const k of Object.keys(c.mixed)) { const x = b.mixed[k] || {}, y = c.mixed[k]; console.log(`  ${k.padEnd(40)} mixed ${pct(x.mixed_recall)} -> ${pct(y.mixed_recall)}  any flag ${pct(x.flagged_recall)} -> ${pct(y.flagged_recall)}  hosts falsely mixed ${x.host_false_mixed} -> ${y.host_false_mixed} (n=${y.n})`); }
  console.log(`all real humans falsely 'mixed': ${b.human_false_mixed.mixed} -> ${c.human_false_mixed.mixed} of ${c.human_false_mixed.n}`);
  console.log("reformatted humans flagged:", JSON.stringify(b.reformatted), "->", JSON.stringify(c.reformatted));
  console.log("by length (recall / fp):", Object.entries(c.byLength).map(([k, v]) => `${k}: ${pct(b.byLength[k].recall)}/${b.byLength[k].fp} -> ${pct(v.recall)}/${v.fp}`).join("; "));
}

function html(out) {
  const b = out.baseline, c = out.current;
  const esc = s => String(s).replace(/[&<>]/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[x]));
  const row = (k, x, y, f) => `<tr><td>${esc(k)}</td><td class="n">${f(x)}</td><td class="n">${f(y)}</td></tr>`;
  const m = (x, k) => x && x[k] != null ? x[k] : null;
  const slices = Object.keys(c.slices).map(k => { const x = b.slices[k] || {}, y = c.slices[k];
    return y.recall != null ? `<tr><td>${esc(k)}</td><td class="n">${y.n_ai}</td><td class="n">${pct(x.recall)}</td><td class="n">${pct(y.recall)} <span class="ci">${ciS(y.recall_ci)}</span></td><td class="n">${x.fp ?? "-"} → ${y.fp}</td><td class="n">${y.roc_auc != null ? y.roc_auc.toFixed(3) : "-"}</td></tr>`
      : `<tr><td>${esc(k)}</td><td class="n">${y.n}</td><td class="n">${pct(x.rate)}</td><td class="n">${pct(y.rate)} <span class="ci">${ciS(y.rate_ci)}</span></td><td class="n">called AI</td><td class="n">-</td></tr>`; }).join("");
  const fp = Object.keys(c.humanFP).sort().map(k => { const x = b.humanFP[k] || {}, y = c.humanFP[k]; return `<tr><td>${esc(k)}</td><td class="n">${y.n}</td><td class="n">${x.fp ?? "-"}</td><td class="n">${y.fp} <span class="ci">${ciS(y.fpr_ci, 2)}</span></td><td class="n">${x.mixed ?? "-"} → ${y.mixed}</td></tr>`; }).join("");
  const mixed = Object.keys(c.mixed).map(k => { const x = b.mixed[k] || {}, y = c.mixed[k]; return `<tr><td>${esc(k)}</td><td class="n">${y.n}</td><td class="n">${pct(x.mixed_recall)} → ${pct(y.mixed_recall)} <span class="ci">${ciS(y.mixed_recall_ci)}</span></td><td class="n">${pct(x.flagged_recall)} → ${pct(y.flagged_recall)}</td><td class="n">${x.host_false_mixed ?? "-"} → ${y.host_false_mixed}</td><td class="n">${y.located_rate != null ? pct(y.located_rate) : "-"}</td></tr>`; }).join("");
  const len = Object.keys(c.byLength).map(k => `<tr><td>${k}</td><td class="n">${c.byLength[k].n_human} / ${c.byLength[k].n_ai}</td><td class="n">${pct(b.byLength[k].recall)} → ${pct(c.byLength[k].recall)}</td><td class="n">${b.byLength[k].fp} → ${c.byLength[k].fp}</td><td class="n">${m(c.byLength[k], "roc_auc") != null ? c.byLength[k].roc_auc.toFixed(3) : "-"}</td></tr>`).join("");
  const attr = Object.keys(c.attribution).sort().map(k => { const y = c.attribution[k]; const named = y.right + y.wrong; return `<tr><td>${esc(k)}</td><td class="n">${y.n}</td><td class="n">${named ? pct(y.right / named) : "-"}</td><td class="n">${named ? pct(y.wrong / named) : "-"}</td><td class="n">${pct(y.unclear / y.n)}</td></tr>`; }).join("");
  const W = 320, Hh = 200, pr = c.overall_core.pr.points, pb = b.overall_core.pr.points;
  const path_ = pts => pts.map((p, i) => `${i ? "L" : "M"}${(p[0] * W).toFixed(1)},${((1 - p[1]) * Hh * 4 > Hh ? Hh : (1 - p[1]) * Hh * 4).toFixed(1)}`).join(" ");
  const rel = c.overall_core.reliability.filter(x => x.meanP != null);
  const o = c.overall_core, ob = b.overall_core;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Detector Benchmark (${out.half})</title>
<style>:root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a66;--line:#e3e0d8;--card:#fff;--acc:#2f6f5e;--warn:#9a4b1f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--fg:#ecebe6;--mut:#a3a19a;--line:#2e2d2a;--card:#1e1e1c;--acc:#7cc4ad;--warn:#e19a6c}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px}main{max-width:1050px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}.mut{color:var(--mut)}.ci{color:var(--mut);font-size:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.kpi b{display:block;font-size:20px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);font-size:13.5px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}
svg{background:var(--card);border:1px solid var(--line);border-radius:8px;max-width:100%}</style></head><body><main>
<h1>Detector benchmark: ${out.half === "final" ? "sealed final half" : "dev half"}</h1>
<p class="mut">Generated ${out.generated.slice(0, 16)} UTC · model ${out.modelHash} · v12.3 baseline vs current. ${out.half === "final" ? "The final half is never used for tuning; each run is logged in docs/final-runs.md." : "The dev half is used for every design decision, so these numbers are optimistic compared with the sealed final half."} Brackets are 95% confidence intervals.</p>
<div class="kpis"><div class="kpi"><span class="mut">Real humans wrongly flagged (core)</span><b>${ob.fp} → ${o.fp} of ${o.n_human}</b><span class="ci">${ciS(o.fpr_ci, 3)}</span></div>
<div class="kpi"><span class="mut">AI caught (core)</span><b>${pct(ob.recall)} → ${pct(o.recall)}</b><span class="ci">${ciS(o.recall_ci)}</span></div>
<div class="kpi"><span class="mut">Precision of "likely AI"</span><b>${pct(ob.precision, 2)} → ${pct(o.precision, 2)}</b><span class="ci">${ciS(o.precision_ci, 2)}</span></div>
<div class="kpi"><span class="mut">ROC-AUC</span><b>${ob.roc_auc.toFixed(4)} → ${o.roc_auc.toFixed(4)}</b><span class="ci">[${o.roc_auc_ci.map(x => x.toFixed(4)).join(", ")}]</span></div>
<div class="kpi"><span class="mut">Brier / calibration error</span><b>${o.brier.toFixed(3)} / ${o.ece.toFixed(3)}</b><span class="ci">was ${ob.brier.toFixed(3)} / ${ob.ece.toFixed(3)}</span></div>
<div class="kpi"><span class="mut">Mixed essays spotted (broad)</span><b>${c.mixed.broad ? pct(b.mixed.broad.mixed_recall) + " → " + pct(c.mixed.broad.mixed_recall) : "-"}</b><span class="ci">${c.mixed.broad ? "hosts falsely mixed " + b.mixed.broad.host_false_mixed + " → " + c.mixed.broad.host_false_mixed : ""}</span></div></div>
<h2>Precision–recall curve (core test set)</h2><svg viewBox="-30 -10 ${W + 40} ${Hh + 40}" width="${W + 40}" role="img" aria-label="precision recall curve"><path d="${path_(pb)}" fill="none" stroke="var(--mut)" stroke-dasharray="4 3"/><path d="${path_(pr)}" fill="none" stroke="var(--acc)" stroke-width="2"/><text x="0" y="${Hh + 18}" font-size="11" fill="currentColor">recall 0 → 1</text><text x="-28" y="8" font-size="10" fill="currentColor">P=1</text><text x="-28" y="${Hh}" font-size="10" fill="currentColor">P=.75</text></svg>
<p class="mut">Solid: current. Dashed: v12.3. The y-axis spans precision 0.75–1.</p>
<h2>Calibration (current, classes balanced)</h2><div class="tw"><table><tr><th>Shown likelihood</th><th class="n">Texts</th><th class="n">Mean shown</th><th class="n">Share actually AI</th></tr>${rel.map(x => `<tr><td>${Math.round(x.from * 100)}–${Math.round(x.from * 100 + 10)}%</td><td class="n">${x.n}</td><td class="n">${pct(x.meanP)}</td><td class="n">${pct(x.fracAI)}</td></tr>`).join("")}</table></div>
<h2>Slices</h2><div class="tw"><table><tr><th>Slice</th><th class="n">AI texts</th><th class="n">v12.3</th><th class="n">Current recall</th><th class="n">Humans flagged</th><th class="n">AUC</th></tr>${slices}</table></div>
<h2>By length</h2><div class="tw"><table><tr><th>Words</th><th class="n">Human / AI</th><th class="n">Recall</th><th class="n">Humans flagged</th><th class="n">AUC</th></tr>${len}</table></div>
<h2>Real human texts wrongly flagged, by source</h2><div class="tw"><table><tr><th>Source</th><th class="n">Texts</th><th class="n">v12.3</th><th class="n">Current</th><th class="n">Labelled Mixed</th></tr>${fp}</table></div>
<h2>Mixed human/AI documents</h2><div class="tw"><table><tr><th>Set</th><th class="n">Docs</th><th class="n">Labelled Mixed</th><th class="n">Mixed or AI</th><th class="n">Human version falsely Mixed</th><th class="n">Right paragraph</th></tr>${mixed}</table></div>
<p class="mut">All real human documents labelled Mixed: ${b.human_false_mixed.mixed} → ${c.human_false_mixed.mixed} of ${c.human_false_mixed.n}. Reformatted humans flagged: ${esc(JSON.stringify(b.reformatted))} → ${esc(JSON.stringify(c.reformatted))}.</p>
<h2>Which AI (when one is named)</h2><div class="tw"><table><tr><th>AI texts</th><th class="n">Judged not human</th><th class="n">Right</th><th class="n">Wrong</th><th class="n">Can't tell</th></tr>${attr}</table></div>
</main></body></html>`;
}

main();

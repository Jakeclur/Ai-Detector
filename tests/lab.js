// Run the Test lab from the command line.
//   node tests/lab.js [file] [cutoff]
// file: passages separated by lines of "---", each starting with a label line
//       (Human / Claude / ChatGPT / AI). Defaults to src/testlab_samples.txt.
const path = require("path");
const fs = require("fs");
const E = require(path.join(__dirname, "../src/core.js"));
const ENS = require(path.join(__dirname, "../src/ensemble.js"));   // v10: trained model + rule engine

const file = process.argv[2] || path.join(__dirname, "../src/testlab_samples.txt");
// cut-off: "auto" (default) uses the detector's own genre-aware cut-offs; a number uses a fixed likelihood cut-off
const cut = process.argv[3] ? +process.argv[3] : "auto";
const raw = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim();
const rows = [];
for (const blk of raw.split(/\n\s*-{3,}\s*\n/)) {
  const lines = blk.trim().split("\n");
  const m = lines[0].match(/^\s*\[?\s*(human|claude|chatgpt|gpt|openai|ai|other)\s*\]?\s*:?\s*$/i);
  let label = "Unlabelled";
  if (m) { lines.shift(); const l = m[1].toLowerCase(); label = l === "human" ? "Human" : l === "claude" ? "Claude" : /chatgpt|gpt|openai/.test(l) ? "ChatGPT" : "AI"; }
  const text = E.cleanText(lines.join("\n")).text;
  const r = ENS.assess(text);
  if (r.tooShort) { rows.push({ label, wc: r.wc, short: true }); continue; }
  const a = r.attr;   // trained attribution (with rule clues as evidence)
  const flagged = cut === "auto" ? r.band === "ai" : r.score >= cut;
  const isAI = !["Human", "Unlabelled"].includes(label);
  const det = label === "Unlabelled" ? "" : (isAI ? flagged : !flagged) ? "ok" : "WRONG";
  let lean = r.band !== "human" || r.counts.hard ? a.lean : "unclear";   // same rule as the page
  if (lean === "unclear" && r.specialist) lean = "claude";               // the trained recent-Claude check matched
  const mdl = ["Claude", "ChatGPT"].includes(label) ? (lean === "unclear" ? "can't tell" : lean === label.toLowerCase() ? "ok" : "WRONG") : "";
  rows.push({ label, wc: r.wc, score: r.score, band: r.band, lean, flagged, conf: a.confidence, det, mdl, start: text.replace(/\s+/g, " ").slice(0, 45) });
}
console.log("label    words score band          looks-like        detected model      start");
for (const r of rows) {
  if (r.short) { console.log(`${r.label.padEnd(8)} ${String(r.wc).padStart(5)}  too short`); continue; }
  console.log(`${r.label.padEnd(8)} ${String(r.wc).padStart(5)} ${String(r.score).padStart(5)} ${r.band.padEnd(13)} ${(r.lean + "/" + r.conf).padEnd(17)} ${r.det.padEnd(8)} ${r.mdl.padEnd(10)} ${r.start}`);
}
const ok = rows.filter(r => !r.short);
const hum = ok.filter(r => r.label === "Human"), ai = ok.filter(r => ["Claude", "ChatGPT", "AI"].includes(r.label));
const md = ok.filter(r => r.mdl);
console.log(`\ncut-off ${cut}: humans wrongly flagged ${hum.filter(r => r.flagged).length}/${hum.length}, AI caught ${ai.filter(r => r.flagged).length}/${ai.length}, model right ${md.filter(r => r.mdl === "ok").length}/${md.length} (wrong ${md.filter(r => r.mdl === "WRONG").length})`);

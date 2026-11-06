// Run the Test lab from the command line.
//   node tests/lab.js [file] [cutoff]
// file: passages separated by lines of "---", each starting with a label line
//       (Human / Claude / ChatGPT / AI). Defaults to src/testlab_samples.txt.
const path = require("path");
const fs = require("fs");
const E = require(path.join(__dirname, "../src/core.js"));

const file = process.argv[2] || path.join(__dirname, "../src/testlab_samples.txt");
const cut = +(process.argv[3] || E.BANDS.ai);
const raw = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim();
const rows = [];
for (const blk of raw.split(/\n\s*-{3,}\s*\n/)) {
  const lines = blk.trim().split("\n");
  const m = lines[0].match(/^\s*\[?\s*(human|claude|chatgpt|gpt|openai|ai|other)\s*\]?\s*:?\s*$/i);
  let label = "Unlabelled";
  if (m) { lines.shift(); const l = m[1].toLowerCase(); label = l === "human" ? "Human" : l === "claude" ? "Claude" : /chatgpt|gpt|openai/.test(l) ? "ChatGPT" : "AI"; }
  const text = E.cleanText(lines.join("\n")).text;
  const r = E.analyze(text);
  if (r.tooShort) { rows.push({ label, wc: r.wc, short: true }); continue; }
  const a = E.attribute(text, r);
  const isAI = !["Human", "Unlabelled"].includes(label);
  const det = label === "Unlabelled" ? "" : (isAI ? r.score >= cut : r.score < cut) ? "ok" : "WRONG";
  const mdl = ["Claude", "ChatGPT"].includes(label) ? (a.lean === "unclear" ? "can't tell" : a.lean === label.toLowerCase() ? "ok" : "WRONG") : "";
  rows.push({ label, wc: r.wc, score: r.score, band: r.band, lean: a.lean, conf: a.confidence, det, mdl, start: text.replace(/\s+/g, " ").slice(0, 45) });
}
console.log("label    words score band          looks-like        detected model      start");
for (const r of rows) {
  if (r.short) { console.log(`${r.label.padEnd(8)} ${String(r.wc).padStart(5)}  too short`); continue; }
  console.log(`${r.label.padEnd(8)} ${String(r.wc).padStart(5)} ${String(r.score).padStart(5)} ${r.band.padEnd(13)} ${(r.lean + "/" + r.conf).padEnd(17)} ${r.det.padEnd(8)} ${r.mdl.padEnd(10)} ${r.start}`);
}
const ok = rows.filter(r => !r.short);
const hum = ok.filter(r => r.label === "Human"), ai = ok.filter(r => ["Claude", "ChatGPT", "AI"].includes(r.label));
const md = ok.filter(r => r.mdl);
console.log(`\ncut-off ${cut}: humans wrongly flagged ${hum.filter(r => r.score >= cut).length}/${hum.length}, AI caught ${ai.filter(r => r.score >= cut).length}/${ai.length}, model right ${md.filter(r => r.mdl === "ok").length}/${md.length} (wrong ${md.filter(r => r.mdl === "WRONG").length})`);

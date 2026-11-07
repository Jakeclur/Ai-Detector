// Cross-fitted copies of the general model for training second-stage models (the mixed-authorship model) on
// realistic scores. Training documents are split into two folds by a hash of their group; the copy trained on one
// fold is used to score documents of the other fold.
//   V12DATA=1 node tests/crossfit.js <A|B>   -> tests/.cache/crossfit_<A|B>.json (general model trained WITHOUT fold <A|B>)
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const T = require("./train.js");
const fold = process.argv[2]; if (!/^[AB]$/.test(fold || "")) { console.error("usage: crossfit.js A|B"); process.exit(2); }
const foldOf = g => (parseInt(crypto.createHash("md5").update(g + "|crossfit").digest("hex").slice(0, 8), 16) % 2) ? "B" : "A";
const t0 = Date.now();
const rows = T.loadRows("train").filter(r => foldOf(r.group) !== fold);
console.log(`fold ${fold}: training on ${rows.length} rows from the other fold`);
const M = T.trainAll(rows, { useRules: true, useStyle: true, useVocab: true, useChr: true, modernWeight: 8, humanWeight: 2 }, { l2: 0.01, gbdt: true, hiPct: 0.999, genrePct: 0.9995 });
const json = T.toJSON(M);
fs.mkdirSync(path.join(__dirname, ".cache"), { recursive: true });
fs.writeFileSync(path.join(__dirname, `.cache/crossfit_${fold}.json`), JSON.stringify(json));
console.log(`wrote crossfit_${fold}.json in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
module.exports = { foldOf };

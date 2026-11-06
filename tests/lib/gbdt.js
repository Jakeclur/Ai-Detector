// Small gradient-boosted decision trees (logistic loss) for the v11 classifier.
// Pure JS, no dependencies. Features are pre-binned into quantile bins for speed.
// Monotone constraints: for features with sign -1 (may only push towards human) or +1 (may only push
// towards AI), a split is rejected if the higher-value side would get the "wrong" direction.
function quantileBins(X, nBins = 32) {
  const d = X[0].length, edges = [];
  for (let j = 0; j < d; j++) {
    const col = X.map(v => v[j]).sort((a, b) => a - b), e = [];
    for (let b = 1; b < nBins; b++) { const q = col[Math.floor(b / nBins * (col.length - 1))]; if (!e.length || q > e[e.length - 1]) e.push(q); }
    edges.push(e);
  }
  return edges;
}
function binRow(v, edges) { const out = new Uint8Array(v.length); for (let j = 0; j < v.length; j++) { const e = edges[j]; let lo = 0, hi = e.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v[j] > e[m]) lo = m + 1; else hi = m; } out[j] = lo; } return out; }

function fitGBDT(X, y, w, { trees = 200, depth = 3, lr = 0.08, lambda = 5, minLeaf = 40, colsample = 0.5, sign = null, seed = 11, edges = null } = {}) {
  const n = X.length, d = X[0].length;
  edges = edges || quantileBins(X);
  const B = X.map(v => binRow(v, edges));
  const F = new Float64Array(n);  // current logit
  let rs = seed; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  // base score
  const W = w.reduce((a, b) => a + b, 0), pos = y.reduce((a, b, i) => a + b * w[i], 0);
  const base = Math.log(pos / (W - pos)); F.fill(base);
  const model = { base, trees: [], edges };
  const g = new Float64Array(n), h = new Float64Array(n);
  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < n; i++) { const p = 1 / (1 + Math.exp(-F[i])); g[i] = (p - y[i]) * w[i]; h[i] = Math.max(1e-6, p * (1 - p)) * w[i]; }
    const cols = []; for (let j = 0; j < d; j++) if (rnd() < colsample) cols.push(j);
    const nodes = [];   // flat tree: {f, b, l, r} or {leaf}
    const build = (idx, dep, lowBound, highBound) => {
      let G = 0, H = 0; for (const i of idx) { G += g[i]; H += h[i]; }
      let leaf = -G / (H + lambda); leaf = Math.max(lowBound, Math.min(highBound, leaf));
      const id = nodes.length; nodes.push({ leaf });
      if (dep >= depth || idx.length < 2 * minLeaf) return id;
      let best = null;
      for (const j of cols) {
        const nb = edges[j].length + 1; if (nb < 2) continue;
        const gs = new Float64Array(nb), hs = new Float64Array(nb), cs = new Uint32Array(nb);
        for (const i of idx) { const b = B[i][j]; gs[b] += g[i]; hs[b] += h[i]; cs[b]++; }
        let gl = 0, hl = 0, cl = 0;
        for (let b = 0; b < nb - 1; b++) {
          gl += gs[b]; hl += hs[b]; cl += cs[b];
          const cr = idx.length - cl; if (cl < minLeaf || cr < minLeaf) continue;
          const gr = G - gl, hr = H - hl;
          const vl = -gl / (hl + lambda), vr = -gr / (hr + lambda);
          if (sign && sign[j] < 0 && vr > vl) continue;   // higher value must not push towards AI
          if (sign && sign[j] > 0 && vr < vl) continue;   // higher value must not push towards human
          const gain = gl * gl / (hl + lambda) + gr * gr / (hr + lambda) - G * G / (H + lambda);
          if (!best || gain > best.gain) best = { gain, j, b, vl, vr };
        }
      }
      if (!best || best.gain <= 1e-9) return id;
      const L = [], R = []; for (const i of idx) (B[i][best.j] <= best.b ? L : R).push(i);
      // monotone bounds for children (keeps whole subtrees consistent for constrained features)
      let lb = [lowBound, highBound], rb = [lowBound, highBound];
      if (sign && sign[best.j] !== 0) { const mid = (best.vl + best.vr) / 2; if (sign[best.j] < 0) { lb = [mid, highBound]; rb = [lowBound, mid]; } else { lb = [lowBound, mid]; rb = [mid, highBound]; } }
      nodes[id] = { f: best.j, t: best.b < edges[best.j].length ? edges[best.j][best.b] : Infinity };
      nodes[id].l = build(L, dep + 1, lb[0], lb[1]);
      nodes[id].r = build(R, dep + 1, rb[0], rb[1]);
      return id;
    };
    build(Array.from({ length: n }, (_, i) => i), 0, -Infinity, Infinity);
    for (const nd of nodes) if ("leaf" in nd) nd.leaf *= lr;
    model.trees.push(nodes);
    for (let i = 0; i < n; i++) F[i] += predictTree(nodes, X[i]);
  }
  return model;
}
function predictTree(nodes, v) { let k = 0; for (;;) { const nd = nodes[k]; if ("leaf" in nd && nd.f === undefined) return nd.leaf; k = v[nd.f] <= nd.t ? nd.l : nd.r; } }
function predictGBDT(m, v) { let z = m.base; for (const t of m.trees) z += predictTree(t, v); return z; }
// compact form for the page: per tree arrays
function packGBDT(m) {
  return { base: +m.base.toFixed(5), trees: m.trees.map(nodes => nodes.map(nd => nd.f === undefined ? [+nd.leaf.toFixed(5)] : [nd.f, nd.t === Infinity ? 1e9 : +nd.t.toFixed(5), nd.l, nd.r])) };
}
module.exports = { fitGBDT, predictGBDT, packGBDT, quantileBins };

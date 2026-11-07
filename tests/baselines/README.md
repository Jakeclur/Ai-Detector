# Frozen baselines

`v12.3/` is an exact copy of `src/core.js`, `src/stats.js`, `src/ensemble.js` and `src/model.json` as shipped in v12.3
(git commit d8e6c49 and earlier). `tests/benchmark.js` scores it in its own process (the engine keeps state in globals),
so every report compares the current `src/` against the same fixed starting point.

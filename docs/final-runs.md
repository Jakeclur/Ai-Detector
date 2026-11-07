# Sealed final-half runs

Every run of `CONFIRM_FINAL=yes node tests/benchmark.js --final` is logged here automatically. The final half is never used for tuning.

| Date (UTC) | Model hash | Humans flagged | AI caught (core) | ROC-AUC | Independent Claude caught | Mixed recall / hosts falsely mixed |
|---|---|---|---|---|---|---|
| 2026-11-07T15:45 | 66c665b2ee52 | 5/7750 | 81.8% | 0.9951 | 53.8% | 27.2% / 3 |
| 2026-11-07T15:49 | 50ad8c61d03a | 1/7750 | 81.6% | 0.9954 | 33.3% | 27.3% / 3 |

**Notes on the runs above.**
1. 2026-11-07T15:45 (model 66c665b2ee52): v14 candidate with the E10 recent-Claude specialist. Core humans flagged rose 1 → 5 (student essays +2, ASAP +1, Reddit +1), so the specialist change was reverted under hard requirement 6 (see `docs/experiment-log.md`, E10).
2. 2026-11-07T15:49 (model 50ad8c61d03a) is the shipped v14: the v12.3 specialist restored, the new mixed detector kept. Its "Likely AI" decisions are identical to v12.3's; only Mixed changed.

# Changelog

## 0.1.0 (2026-10-12)

First release of the Python port: the core plumbing and a first set of methods, built to send
byte-for-byte the same requests as the TypeScript package (so the two share one answer cache).

- Methods: `classify`, `extract_value`, `screen`, `rank_by_score`.
- One-question tasks: `check`, `checks`, `choose`, `rate`.
- Plumbing: state parts and `Ref`s, `choice` / `noul` / `score`, readings with TypeSafe's confidence
  formulas, `run` and `run_all`, `request` and `request_all`, pre-send `lint`, `send`,
  `estimate_tokens` and `estimate_cost`.
- Clients: `typesafe_jev()` (TypeSafe's SDK with retries for batch work), `cached_jev()` (record and
  replay answers on disk, the same files and keys as the TypeScript cache), `fake_jev()` for tests.

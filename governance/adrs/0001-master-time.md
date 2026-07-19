# ADR 0001 — Rational master time

**Status:** Accepted

Chai Studio owns time as a non-negative integer master-frame index plus rational FPS. Ranges are half-open. Source frames use explicit floor mapping; audio ranges use floor at the inclusive start and ceiling at the exclusive end. Engines halt and prepare behind one seek barrier; they never advance authoritative time independently.

Evidence: `tests/rational.test.mjs`, `tests/scheduler.test.mjs`, `tests/audio-transport.test.mjs`, and `evidence/benchmark-report.json`.

Rejected: floating-point seconds as authority, independent engine clocks, and drop-frame timecode as timing math. P02 measured the native browser-proxy path; P09 repeats acceptance against production process adapters without changing scheduler ownership.

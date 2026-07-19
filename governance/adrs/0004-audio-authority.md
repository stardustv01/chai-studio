# ADR 0004 — One audio authority

**Status:** Accepted

The shared Chai Studio audio graph follows scheduler time and owns program audio. Native engine audio is suppressed except explicit source inspection. Preview and final graphs use the same parameters. Offline boundaries are integer samples. The initial mixed mezzanine is PCM-in-MOV so video and audio endpoints are sample-exact.

Evidence: `tests/audio-transport.test.mjs`, `evidence/web-audio-result.json`, `evidence/canonical-fixture-validation.json`, `evidence/mixed-finish-result.json`, and `evidence/benchmark-report.json`.

Rejected: engine-local program mixes and accepting AAC stream duration as sample authority. The MP4 spike showed 2,848 encoded padding samples; AAC is a delivery codec whose delay/padding must be declared in QA and receipts, not a master audio representation.

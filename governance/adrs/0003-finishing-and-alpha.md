# ADR 0003 — Finishing and transparent bridges

**Status:** Accepted

Remotion is the initial replaceable finishing compositor behind `render-core`; it is not project authority. The canonical mixed finish consumes Remotion, HyperFrames, shared video/image, captions, central audio, and a transparent bridge. RGBA PNG sequence is the supported transparent bridge default for the pinned runtime.

Evidence: `evidence/mixed-finish-result.json`, `evidence/mixed-finish-contact.png`, `evidence/alpha-format-decision.json`, and `evidence/canonical-fixture-validation.json`.

Rejected for this runtime: qtrle/ARGB MOV inside Remotion `OffthreadVideo`, which failed with `Decoder not found`. It remains a valid FFmpeg artifact but not an approved Remotion bridge. PNG sequences cost more disk and file operations; P20 may add another format only after decoder, alpha, parity, and boundary evidence.

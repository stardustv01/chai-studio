# Frozen contract 04 — Caption rendering v1

`caption-core` produces deterministic artifacts; preview, compositor, subtitle export, and QA consume them. Caption production has no dependency on the final encoder.

The layer plan contains project/revision/timeline/track/cue/style identities; half-open integer frame ranges; text, lines, speaker, correction/lock state; word-highlight sampling; typography, boxes, alignment, safe area, collision and highlight rules; font-file and glyph hashes; dimensions, rational FPS, color/alpha; deterministic identity; and QA anchors at every start and final included frame.

Cues sort by start frame then stable ID. Invalid ranges, overlaps disallowed by the selected template/profile, missing glyphs/fonts, unsafe placement, excessive reading speed, or malformed subtitle output emit entity-scoped diagnostics and may block the profile. Burn-in and SRT/VTT output evaluate the same timing authority; export rounding is declared by format and does not alter the layer plan.

Evidence: `src/caption-plan.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/caption-plan.json`.

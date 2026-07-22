# Chai Studio — Caption Render Contract Draft

**Status:** Draft; freeze at P02.19

## Producer/consumer boundary

The caption subsystem produces deterministic artifacts. Preview, compositor, encoder, QA, and subtitle delivery consume them. Caption production never depends on a final encoder.

## Required caption layer artifact

- Project, revision, timeline, track, cue, and style-template identity.
- Integer frame ranges and documented word-highlight sampling.
- Text, lines, speaker, lock/correction state, and layout constraints.
- Typography, box, alignment, safe area, highlighting, and collision plan.
- Font files and glyph dependency hashes.
- Render dimensions, rational FPS, color/alpha contract, and artifact hash.
- QA anchors for boundaries, phrase sync, collision, safe zone, line length, reading speed, and glyph availability.

## Outputs

- Burn-in compositor layer plan.
- Separate SRT/VTT or approved subtitle artifact.
- Preview representation with the same timing/style evaluation.

## Boundary rules

Cues use half-open integer-frame ranges. Malformed, overlapping, missing-glyph, unsafe, or unreadable cues produce explicit diagnostics and may block the selected delivery profile.

# ADR 0009 — P26 production performance and accessibility baseline

**Status:** Accept for the personal macOS production baseline  
**Date:** 2026-07-16

## Decision

Freeze the P26 measured support environment to Apple M4, 16 GB unified memory, arm64 macOS. Measure eight representative project classes using local deterministic fixtures. Enforce class-specific derived-index p95 budgets and a maximum comparable-regression ratio of 1.15.

Performance samples and reports remain local. A cache hit is diagnostic information, not proof of correctness. Exact state, validation, render truth, recovery, containment, and selective invalidation remain unchanged by optimization.

When interactive preview misses budget, use the visible reversible ladder: report dropped frames, reduce preview quality, disable expensive preview effects, then render an exact preview range. Never claim frame-perfect real-time playback while degrading.

Accessibility and keyboard support are production constraints: persistent shortcut customization with conflict handling, screen-reader summaries, focus restoration, high contrast, reduced motion, scalable text, and non-color-only state indicators are required by the P26 gate.

## Consequences

- P02 ADR 0008 remains historical benchmark evidence but no longer owns the active production budget.
- P26 does not claim measured support for untested hardware.
- Material budget regressions fail acceptance unless support is explicitly narrowed and documented.
- P28 must rerun final performance, soak, stress, and resource-ceiling acceptance before release.

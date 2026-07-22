# Chai Studio — Timing and Audio Contract Draft

**Status:** Draft; freeze at P02.16

## Timing authority

- Edit positions and durations are integer master frames.
- Rates and speed ratios are normalized rationals.
- Ranges are half-open: `[startFrame, endFrame)`.
- Rounding occurs only at declared domain boundaries.
- Timeline-to-source frame sampling defaults to floor after exact rational transformation unless an adapter defines another deterministic rule.
- Audio sample ranges use floor for the inclusive start and ceiling for the exclusive end.
- Drop-frame timecode changes labels only.

## Transport authority

The preview scheduler owns master time, session identity, play rate, loop/range state, seek barriers, and hard resynchronization. An engine or audio layer may optimize playback but may not independently advance authoritative time.

A seek halts attached engines and audio, requests the exact frame/sample state, waits for readiness or explicit degradation, and presents atomically.

## Audio authority

- One shared graph represents sources, buses, gain, pan, fades, automation, ducking, channel maps, and processing references.
- Engine-native audio is suppressed in the program mix.
- Preview and offline final mix evaluate the same graph and automation values.
- Scrub, J/K/L, non-unit rate, latency, drift measurement, and correction behavior require Milestone 0 evidence.
- Final mix identity includes graph, source hashes, sample rate, channel layout, processing versions, and exact timeline range.

## Blocking conditions

Independent clocks, unexplained rounding, double-mixed engine audio, long-timeline drift above the frozen budget, or preview/final parameter divergence block contract acceptance.

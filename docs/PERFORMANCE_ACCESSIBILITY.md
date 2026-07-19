# Performance, accessibility, and honest degradation

P26 freezes one production support claim: Chai Studio is measured for personal-use macOS on an Apple M4 with 16 GB unified memory and arm64. The eight project classes are small, medium, long, hundreds of clips, heavy WebGL, captions, audio, and mixed-engine bridges. Other machines may work, but P26 does not present them as measured support.

## Local measurement

`fixtures/performance/project-classes.json` owns the hardware and project-class fixtures. `fixtures/performance/budgets.json` owns the class-specific p95 limits and the 15% regression ceiling. `scripts/run-p26-benchmarks.mjs` detects the real machine, refuses to relabel another machine as the M4 fixture, rebuilds representative timeline snapshots, and writes `evidence/p26/benchmark-report.json`.

The diagnostics contract names cold start, project open, snapshot load, schema validation, derived-index rebuild, revision diff, seek, frame-step, play drift, timeline interaction/search, inspector update, exact capture, proxy generation, render throughput, memory, GPU, disk, and cache hit rate. Browser samples are bounded in memory. Benchmark evidence is written locally, and no telemetry is uploaded.

## Optimization boundaries

- Immutable snapshot identity reuses derived indexes; changed snapshots rebuild from authoritative data.
- Revision diff has identity/reference fast paths but retains whole-project validation and exact structural comparison.
- The timeline mounts only visible track rows with overscan, memoizes track/selection/search projections, and keeps drag state provisional until a validated command is submitted.
- Existing bounded preview preload, adapter lifecycle, proxy quality, worker, resource-ownership, content-addressed cache, cleanup, dependency-hash, and selective-invalidation contracts remain authoritative. A speed improvement never converts a cache hit into correctness evidence.

## Honest degradation

The visible, reversible ladder is: report dropped frames, lower interactive quality, disable expensive preview effects, and render an exact preview range. Interactive preview never claims frame-perfect real time. Rendered output remains authoritative, and restoring a step is always available.

## Keyboard and accessibility

The shortcut editor supports search, enabled state, conflict rejection or explicit conflict disabling, JSON import/export, and reset. Core commands remain keyboard operable after customization.

Accessibility preferences persist locally and provide screen-reader timeline summaries, focus restoration for modal surfaces, high contrast, reduced motion, 100/115/130% text scale, and text or symbols alongside color. The E2E matrix exercises the preferences, shortcut conflict path, degradation truth, and reviewed macOS goldens in Playwright-managed Chromium only.

## Stress and regression policy

The deterministic stress matrix covers long playback, repeated seek, hundreds of clips, long render, cancel/retry, low disk, corrupt media, browser restart, and cache cleanup. Each scenario requires stable authority hashes, bounded memory/cache/handle checkpoints, and no corruption. P26 contract tests validate these invariants; P28 repeats final performance and resource-ceiling acceptance before release.

A budget regression blocks the gate when p95 exceeds its class limit or a comparable candidate exceeds 1.15 times its accepted baseline. The remedy is optimization or an explicit support-claim change—never hidden tolerance inflation.

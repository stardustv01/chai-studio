# P13 acceptance — Program monitor and Foundation source inspection

**Decision:** APPROVED for P14 implementation  
**Decision time:** 2026-07-15T18:07:12Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `1510ba1a1a802d3fa127b7b7e7b8240accb05a2c8276efd731b42c6fc4c3f929`

The P13 gate passed all 13 formal checks in one authoritative run: frozen offline install, the P13.01-P13.12 contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, ordinary integration plus sequential real Remotion and HyperFrames runtimes, visual-manifest regression, fixture golden verification, Chrome behavior and UI-golden checks, production build, and security inspection. The accepted repository has 200 unit tests, 10 property/fuzz tests, 50 integration tests, one fixture visual test, 12 Chrome end-to-end tests, and 17 macOS UI goldens including four P13 monitor goldens.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                        |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P13.01 | PASS   | The program viewport implements exact aspect fit/fill, letterbox/pillarbox reporting, checkerboard, zoom, pan, resize observation, and device-pixel-ratio backing dimensions. Pure geometry maps monitor positions to normalized and source coordinates.                                                   |
| P13.02 | PASS   | One preview-truth projection drives interactive/rendered fidelity, proxy/original, native/mixed/baked, buffering, dropped-frame, stale-cache, render-required, and arbitrary server warning presentation. Approximate preview is always visibly labeled.                                                   |
| P13.03 | PASS   | Buttons and keyboard shortcuts resolve to the same typed program commands and authenticated preview-control requests for play/pause, frame/second step, J/K/L, start/end, timeline in/out, loop, and signed rate. Frame and drop-frame timecode derive from the same preview state.                        |
| P13.04 | PASS   | A high-DPI overlay canvas renders action/title safe, thirds, center, custom guides, and selected-layer bounds. Capture requests exclude review overlays unless the explicit opt-in is checked.                                                                                                             |
| P13.05 | PASS   | Fullscreen uses the native Fullscreen API, retains the same monitor state and frame, restores focus on exit, and keeps a visible accessible exit control. Chrome interaction coverage proves entry, exit, and frame preservation.                                                                          |
| P13.06 | PASS   | The compact capture control exposes interactive frame, exact fidelity, isolated clip, before effects, alpha, A/B, range, and contact sheet modes without permanent toolbar clutter. Requests remain pending until server confirmation.                                                                     |
| P13.07 | PASS   | Inspect mode supports split, wipe, onion, and difference comparisons with linked zoom/pan, split position where applicable, and both revision/frame/environment identities.                                                                                                                                |
| P13.08 | PASS   | Foundation source inspection supports video, image, Remotion, and HyperFrames fixtures with an independent scrub/frame clock, exact source time/frame, metadata, isolated audio policy, and preview-only prop/variable audition.                                                                           |
| P13.09 | PASS   | Source review exposes compare-to-timeline, add-to-context, capture, and explicit audition reset. Executable boundary checks reject source in/out, target-track, insert, overwrite, replace, and three-point edit actions.                                                                                  |
| P13.10 | PASS   | Monitor operations have screen-reader names, status hints, keyboard help, context actions, accessible menus, and keyboard-reachable controls.                                                                                                                                                              |
| P13.11 | PASS   | Unit and Chrome interaction tests cover truth modes/warnings, transport parity, capture opt-in, all comparison modes, independent source state, safe audition, reserved-action absence, and fullscreen. Four reviewed P13 macOS goldens cover program, overlays, difference, and Remotion source audition. |
| P13.12 | PASS   | Geometry tests validate exact normalized/source mapping under fit bars, high DPI, zoom, and pan. Resize and fullscreen reuse the same mapping function, keeping annotations aligned.                                                                                                                       |

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p13/gate-report.json`                     | `9d1e0076603e319d402c75a1e89756e0694fb0034ab981a482f10c5fb1058c51` |
| `apps/studio-web/src/monitor-contract.ts`           | `cf8e5da7fe4d2bc8a041c0ea456c2c87e582f13d4eaeb36bf3676ce6de712fdb` |
| `apps/studio-web/src/program-monitor.tsx`           | `c46bb03b7fdff21d746a1d70d261347561d7c3fabe2d25eafe6f6d43a94988dd` |
| `apps/studio-web/src/source-inspection-monitor.tsx` | `37914aa41dce56b77d20e4da1869429dde06078094302224e9c17d7044877cf1` |
| `packages/engine-adapters/src/remotion/renderer.ts` | `7e5472e07191d99cd79ebb03b7728aadc2402b787d71dd9f0064c53592dd6018` |
| `tests/unit/web-monitor-contract.test.ts`           | `16519fc171e281461b52510f75a5981c41d0166de02a6d60584df49029fb034b` |
| `tests/unit/remotion-render-dependencies.test.ts`   | `029be33f8a9059a989064364073b932035a75a9be4e9e90084af6cf60d4ffa0c` |
| `tests/e2e/program-monitor.spec.ts`                 | `17d2e7bcc9917e23e4a6ca373bbb050499095e4f8652252eeef1d64ebdbc10b9` |
| `scripts/validate-p13-monitor-contract.mjs`         | `c5797cf9fa8f6be35b65522afc45c684127498ca153f5e59a284fc962598da3e` |
| `pnpm-lock.yaml`                                    | `d77568ae0de455cb50ec94902d8b074ba161da6bb44918932032f19454c60383` |

The gate report hashes every accepted P13 implementation, test, and golden boundary. Its stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- The program monitor displays authoritative preview state; local view controls may change fit, zoom, pan, overlays, and comparison presentation but cannot invent durable project or playback authority.
- Interactive, proxy, mixed, baked, buffering, stale, dropped, and render-required states stay explicit. Only the final compositor path may claim rendered fidelity.
- Review overlays remain excluded from capture by default. Capture UI creates requests, not success claims; P18 owns durable capture manifests, artifacts, annotations, and Codex context publication.
- Foundation source inspection owns only an independent review clock and preview-only audition state. P14/P15 may add professional editing surfaces, but this Foundation monitor cannot gain source in/out, track targeting, insert, overwrite, replace, or three-point mutation behavior.
- Comparison identities must continue to declare revision, frame, mode, and environment for both sides. Linked presentation never means the compared artifacts share authority or hashes.
- Remotion now re-bundles once only for the precise local serve-URL “no response” failure and only before any range progress. Other failures, cancellations, partial-progress failures, validation errors, and deterministic hash assertions remain strict.

P14 may now implement the authoritative multitrack timeline UI and editing interactions over the accepted P05 command core and P13 transport/monitor contracts.

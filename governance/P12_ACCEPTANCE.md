# P12 acceptance — Shared media adapter and capability registry

**Decision:** APPROVED for P13 implementation  
**Decision time:** 2026-07-15T17:24:04Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Capability registry schema:** `1.0.0`  
**Shared adapter version:** `1.0.0`  
**Gate identity:** `f6fcab61cd0abb3f4fe89e9b5ea09badaa36859bd5106e2f2498d208dc660a90`

The P12 gate passed all 13 formal checks in one authoritative run: frozen offline install, the P12.01-P12.10 contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and sequential real Remotion/HyperFrames browser-runtime tests, visual-manifest regression, fixture golden verification, real-browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 190 unit tests, 10 property/fuzz tests, 50 integration tests, one fixture visual test, six Chrome end-to-end tests, and 13 macOS UI golden screenshots.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P12.01 | PASS   | The versioned registry enforces unique engine/capability identities and the six explicit statuses `native`, `unified`, `bake_required`, `fallback_available`, `unsupported`, and `experimental`. Every record names ownership, preview/render behavior, fallback policy, restrictions, fixture, and evidence. Invalid fallback, unsupported, experimental, ownership, fixture, or evidence contracts fail before use. |
| P12.02 | PASS   | The initial registry covers typography, media, captions, audio, React, HTML/CSS, SVG, Canvas, Lottie, Rive, GSAP, WAAPI, Three.js/WebGL, shaders, particles, transitions, alpha, HDR/color depth, and distributed rendering. Claims cite accepted P10/P11 runtime evidence or deterministic P12 fixtures instead of broad framework assumptions.                                                                      |
| P12.03 | PASS   | `SharedPreviewAdapter` supports image, video, and solid clips. Video maps master frames to exact rational source positions, floors deterministically, optionally maps through an explicit rational proxy transform, preserves original/proxy identities, and includes alpha and common effects in artifact identity.                                                                                                  |
| P12.04 | PASS   | Shared caption plans validate non-empty half-open frame ranges, stable cue/word identities, plan containment, deterministic start-frame/stable-ID sorting, dimensions/FPS, and font/glyph hashes. Cue and word presentation excludes the end frame exactly.                                                                                                                                                           |
| P12.05 | PASS   | Common transform, opacity, crop, blend, adjustment, and capability metadata is validated and frozen. Capability requests resolve through the registry into preview warnings, so unsupported or conversion-required behavior is never silently presented as fully editable.                                                                                                                                            |
| P12.06 | PASS   | Hard cut, dissolve, dip, wipe, push, slide, zoom, and blur primitives sample deterministically over half-open ranges. Property tests cover randomized ranges and every transition family, prove exactly one boundary owner, forbid blank included frames, and verify deterministic endpoints.                                                                                                                         |
| P12.07 | PASS   | Proxy and baked clips carry source identity/hash, cache key, environment class, producer version, creation path, fidelity class, and declared approximation limits in a hashed provenance identity. Equivalent fallbacks cannot claim limitations; approximate fallbacks must declare them.                                                                                                                           |
| P12.08 | PASS   | Program playback always suppresses source/native-engine audio. Source inspection can audition only after an explicit request and remains isolated from the master program graph, preventing double mixing and authority leakage.                                                                                                                                                                                      |
| P12.09 | PASS   | One registry drives inspector descriptors, preview warnings, render actions, fallback selection, and upgrade-fixture selection. A mutation fixture changes all five consumers consistently and changes the registry identity.                                                                                                                                                                                         |
| P12.10 | PASS   | Shared media, rational proxy sampling, alpha, effects, captions, fallback, audio, transitions, registry, and mixed-engine fixtures pass. The production shared adapter passes the same P09 conformance harness used by native adapters and remains frame-aligned with Remotion and HyperFrames under repeated scheduler seeks/play/pause.                                                                             |

## Authoritative evidence identities

| Artifact                                                        | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p12/gate-report.json`                                 | `14bbe9b528eae4e2f85fe166c68436eb147e7f9fdc7ed9431d74f2ff9c20a1f2` |
| `packages/engine-adapters/src/capabilities/contracts.ts`        | `089741baf2b3bed5f2f861c3a4139f65ce75098802e8c798e75b421f185bdb39` |
| `packages/engine-adapters/src/capabilities/registry.ts`         | `b9835f335718f6b3d14a3cea2d1498dfa574d76bd23b77a4278047bd1947ff7e` |
| `packages/engine-adapters/src/capabilities/initial-registry.ts` | `d1e7bd63d172cb516f4ed691494990b41b6ab0adca0b2344131bbc926aeed145` |
| `packages/preview/src/shared/sampling.ts`                       | `8bfc15de7634182f4ec54272bc850228c6ba86553966cee1d1625ebe22262e6c` |
| `packages/preview/src/shared/captions.ts`                       | `077e61b58d1f34fefb39d8f3552f3f61f9390c08e2f71791a67ef57dee4e73e2` |
| `packages/preview/src/shared/transitions.ts`                    | `8aadd265cbfb5d392ce0741812622e35fca25cc4bc30a9191baeadd91ac5ab45` |
| `packages/preview/src/shared/adapter.ts`                        | `af2e451404cf9cd618de48913c7658157eab2481f42ee9ce3662ba067b201691` |
| `tests/unit/capability-registry.test.ts`                        | `f094a65068f02b60d1d310c2ede6dcd3b2650848b1c5310ad56dc065fc95cc2b` |
| `tests/unit/shared-preview-adapter.test.ts`                     | `0122eae5f4ee619716a9fbf364a291754f436ace8102adae931de6b131fcaece` |
| `tests/property/shared-transitions.property.test.ts`            | `9ee30098e6e36c0a1d614eb624ea19f3a65209eb00f772fc05e3dc5837aa25c7` |
| `tests/integration/shared-preview-mixed-engine.test.ts`         | `4e5dc5541632d157feb09fe40abd154089cf3c71d7b40e27d601665dc1b76c06` |
| `scripts/validate-p12-shared-contract.mjs`                      | `c6a2644e43056628352d8aea67a69287db0bd29a0ff4eb08f7e5b9d8d17cd68e` |
| `pnpm-lock.yaml`                                                | `d77568ae0de455cb50ec94902d8b074ba161da6bb44918932032f19454c60383` |

The gate report hashes every accepted P12 implementation and test boundary. Its stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- The capability registry records accepted evidence and policy; it does not convert framework presence into universal native editability. Experimental capabilities require explicit opt-in, unsupported capabilities block, and bake/fallback paths remain visible.
- The shared adapter owns product-level image/video/solid/caption preview semantics, not final render authority. P17 owns final caption artifact production and P20 owns render DAG execution, dependency merging, final shared-media nodes, cache identity, and receipts.
- Caption preview and later caption export must continue to share integer-frame timing, font/glyph identities, and half-open boundaries. P12 does not pre-approve typography templates, subtitle formats, or final collision/reading-speed QA.
- Interactive proxies and baked artifacts always disclose provenance and approximation. An approximate artifact cannot be relabeled as equivalent or final rendered fidelity.
- Program audio remains product-owned. Native and source audio are suppressed during program playback; isolated source audition cannot connect to or mutate the master graph.
- Real Remotion and HyperFrames integration fixtures run sequentially in separate Vitest processes. This prevents their independent ephemeral browser/bundle servers from racing while preserving full real-runtime acceptance; ordinary integrations remain parallel.
- Distributed rendering remains unsupported in the personal local macOS baseline. HDR/higher color depth and unaccepted seek adapters remain experimental until evidence and policy are upgraded through the registry.

P13 may now implement the Foundation editing workspace, project/source monitors, preview controls, interaction state, and recovery/diagnostic surfaces using the accepted shared and native adapter contracts.

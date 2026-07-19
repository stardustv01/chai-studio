# P11 acceptance — HyperFrames engine adapter

**Decision:** APPROVED for P12 implementation  
**Decision time:** 2026-07-15T16:54:02Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Pinned HyperFrames version:** `0.7.58`  
**Gate identity:** `cb5b636778f9669ee3452ff92b3235e94d7bbc37a2112821832417769b9cb4fe`

The P11 gate passed all 13 formal checks in one run: frozen offline install, the P11.01-P11.10 adapter-contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and real Remotion/HyperFrames browser-runtime tests, visual-manifest regression, fixture golden verification, real-browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 181 unit tests, eight property/fuzz tests, 49 integration tests, one fixture visual test, six Chrome end-to-end tests, and 13 macOS UI golden screenshots.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                            |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P11.01 | PASS   | The parser and pinned CLI discover HTML compositions, declared dimensions/rational FPS/duration, variables, tracks, timing attributes, element counts, and active frame adapters; duplicate, missing, conflicting, non-frame-exact, or ambiguous metadata fails before preview.                                                                |
| P11.02 | PASS   | Current `lint` and unified browser `check` JSON contracts are integrated without deprecated aliases. Runtime, layout, motion, contrast, nondeterminism, expensive state, network, source, selector, element, adapter, time/frame, and repair data map to product diagnostics.                                                                  |
| P11.03 | PASS   | `HyperframesPlayerHost` lazily mounts only through a selected worker policy, disables autoplay and native audio, forwards scheduler-frame seeks, waits for exact readiness/current-frame agreement, and supports preload, halt, suspend, and idempotent disposal.                                                                              |
| P11.04 | PASS   | Native playback is a muted scheduler-owned optimization with explicit start frame/rate, session-scoped frame/drop reports, and stale-session rejection. The host passes the accepted P09 adapter conformance harness.                                                                                                                          |
| P11.05 | PASS   | Exact still capture uses rendered PNG-sequence truth rather than the unreliable isolated snapshot boundary path, then records artifact and normalized RGBA SHA-256 identities. Range rendering validates, captures, trims exact half-open frames, reports progress/logs, supports cancellation, and removes partial artifacts.                 |
| P11.06 | PASS   | Selective dependency collection recursively hashes HTML, CSS, media, fonts, scripts, adapters, the pinned package, shaders, data, variable values, and approved network resources into a trust-scoped graph identity.                                                                                                                          |
| P11.07 | PASS   | Inspector descriptors expose source, dimensions, rational FPS, duration, timing, tracks, variables, frame adapters, validation warnings, and native/unified/bake-required/unsupported capabilities. Unsafe or undeclared variables remain read-only.                                                                                           |
| P11.08 | PASS   | Policy validation blocks or reports non-seekable/independent clocks, dynamic code, unapproved network access, navigation, popups, downloads, nondeterministic APIs, expensive state, invalid variables, and CLI runtime/layout/motion/contrast failures.                                                                                       |
| P11.09 | PASS   | Trusted and imported sources receive distinct worker and cache identities. Imported execution is disabled unless a distinct runtime carries current macOS adversarial evidence for network denial, canonical roots, environment sanitation, browser-profile separation, and resource caps; ordinary renderers cannot process imported sources. |
| P11.10 | PASS   | Upgrade/capability fixtures detect and validate seek-safe GSAP, Lottie, Three.js, Rive, WAAPI, D3, PixiJS, shader, and custom frame-adapter families. Runtime/source version drift is blocked before CLI work.                                                                                                                                 |

## Authoritative evidence identities

| Artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p11/gate-report.json`                             | `a3df5662a816c48a677fb72c636062fb6a0bebd75432c7fef217981139ba7530` |
| `packages/engine-adapters/src/hyperframes/contracts.ts`     | `4e0381a4716f567b1b1588af468c0962720f2f37d76816c6b0330b63b099b720` |
| `packages/engine-adapters/src/hyperframes/parser.ts`        | `055a6a5822b60625f02731606a39d819dfebde4863ccb0001dcface75f26b769` |
| `packages/engine-adapters/src/hyperframes/validation.ts`    | `93841d3c65d68f7952420339e2ef8299a997762e26a105df049fea33755cb16d` |
| `packages/engine-adapters/src/hyperframes/player-host.ts`   | `c3b63014b7ed14fe825dd7abe35015065162ada4c5b8578142b4f51ddfe18ddf` |
| `packages/engine-adapters/src/hyperframes/renderer.ts`      | `d000a4a6dc60154cfc4b24fa77374bdeb7497426e06d26d2c856460a8be16c3a` |
| `packages/engine-adapters/src/hyperframes/dependencies.ts`  | `3f2b9468f84be0016f4c136e970fdc60603a273ea024b149c0dfb99340aa0ac4` |
| `packages/engine-adapters/src/hyperframes/worker-router.ts` | `65362b7ae16bd1d9c5678253674de61cf843add4f0918dff08793cf3b9870482` |
| `tests/integration/hyperframes-real-runtime.test.ts`        | `5b05fe7585d65a4391acb97da1f3e057165a6723d3bdc133a6ee2e176cf265a9` |
| `scripts/validate-p11-hyperframes-contract.mjs`             | `7be7046393c113cc680b31e19499f5bd46486ea80fe5bc4efa94b934207fe8a9` |
| `pnpm-workspace.yaml`                                       | `086614a884e4b174d1920d66b84b6f58b92bb09bd5dec96fe22d6d217037a868` |
| `pnpm-lock.yaml`                                            | `d77568ae0de455cb50ec94902d8b074ba161da6bb44918932032f19454c60383` |

The gate report hashes every accepted P11 implementation and test boundary. Its stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- HyperFrames `0.7.58` is an adapter/authoring runtime, not the owner of project schema, revisions, program audio, preview time, final render graph, QA, approval, delivery, or release state.
- The product scheduler remains the sole clock. HyperFrames autoplay and native audio are disabled; native playback may only follow the active scheduler session and cannot commit authoritative time.
- The real fixture reproduced the previously recorded frame-57 isolated-snapshot anomaly. Therefore accepted exact stills use the rendered PNG-sequence capture path and select the declared frame; `snapshot` remains useful for visual review but is not a fidelity authority near boundaries.
- Imported-untrusted execution fails closed without distinct current isolation evidence. P11 freezes selection, provenance, and cache separation; P23 must rerun and harden the macOS adversarial enforcement matrix and disable imports if `sandbox-exec` or another required mechanism is unavailable or stale.
- The production dependency policy permits only `sharp`'s required install check among newly introduced HyperFrames transitive scripts. AI/telemetry/transcription-related transitive install scripts remain denied; runtime telemetry is disabled in adapter and gate invocations.
- Native capability detection proves declared adapter presence and seek registration, not universal semantic editability. P12 owns capability evidence/classification, and P15 must keep unsafe native state read-only or require explicit conversion/baking.
- Engine-local dependency graphs are accepted inputs to later render caching. P20 must merge product, timeline, audio, effects, bridge, environment, lockfile, and approval dependencies before final artifact reuse.

P12 may now implement the shared media adapter and evidence-backed capability registry across native engines, product-owned layers, common transforms, fallbacks, and deterministic mixed-engine fixtures.

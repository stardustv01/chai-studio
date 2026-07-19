# P10 acceptance — Remotion engine adapter

**Decision:** APPROVED for P11 implementation  
**Decision time:** 2026-07-15T16:22:15Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Pinned Remotion family:** `4.0.489`  
**Gate identity:** `9ca36ccaa0fd735de5341267b74528ea657ecd2ffee812dc46be4d505628b94c`

The P10 gate passed all 13 formal checks in one run: frozen offline install, the P10.01-P10.10 adapter-contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and real Remotion/Chrome runtime tests, visual-manifest regression, fixture golden verification, real-browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 172 unit tests, eight property/fuzz tests, 48 integration tests, one fixture visual test, six Chrome end-to-end tests, and 13 macOS UI golden screenshots.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                          |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P10.01 | PASS   | Composition discovery bundles the declared entry point, extracts IDs, calculated/default props, dimensions, rational FPS, and duration, rejects duplicate or ambiguous IDs, and emits structured discovery diagnostics.                                                      |
| P10.02 | PASS   | Pre-render validation checks canonical in-project paths, JSON-safe schema-bound props, delayed rendering policy, dependency paths, unsupported dynamic/nondeterministic/network behavior, rational FPS, and exact runtime-family versions.                                   |
| P10.03 | PASS   | `RemotionPlayerHost` owns lazy host creation, bounded preload, scheduler-frame seek, readiness/current-frame verification, suspend, and idempotent disposal while structurally satisfying the accepted P09 adapter contract.                                                 |
| P10.04 | PASS   | Native playback is only a muted scheduler-controlled optimization: it pauses, seeks, waits, starts at the requested rational rate, reports frame/drop state under the active scheduler session, and rejects stale reports.                                                   |
| P10.05 | PASS   | Exact PNG capture records frame, props/composition, browser, strict environment, settings, dependency graph, color, alpha, artifact SHA-256, and normalized RGBA pixel SHA-256. The pinned real fixture reproduced both the known artifact hash and normalized pixels twice. |
| P10.06 | PASS   | Half-open range rendering maps to the pinned renderer, publishes progress, browser logs and artifact metadata, supports abort cancellation, and removes partial outputs on failure or cancellation. The real fixture encoded frames 0-5 to H.264.                            |
| P10.07 | PASS   | Selective dependency collection recursively hashes source modules plus props, media, fonts, exact runtime packages, approved network resources, and generated code into a stable graph identity.                                                                             |
| P10.08 | PASS   | Browser console, bundle/discovery, validation/delay/asset, still, and range failures become categorized actionable diagnostics with composition/frame identity and mapped source locations where available.                                                                  |
| P10.09 | PASS   | The inspector descriptor exposes calculated metadata, source, dimensions, rational FPS, duration, warnings, and native/unified/bake-required capabilities; only validated primitive schema props become editable controls.                                                   |
| P10.10 | PASS   | A deterministic `chai-finishing-compositor.v1` generator builds sorted Remotion layers behind a replaceable interface, returns source/dependency hashes, and does not import or leak project-schema ownership. Upgrade drift is blocked before bundling.                     |

## Authoritative evidence identities

| Artifact                                                | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p10/gate-report.json`                         | `4e4c0dd03f28db1cda0e95ffc52c16d5acc85764ed5c5b4bb03dbb067ca98dbe` |
| `packages/engine-adapters/src/remotion/contracts.ts`    | `fca00e22c81ed1b631327bc4fe54e652bc366717a180f0b669312c8e713232ac` |
| `packages/engine-adapters/src/remotion/validation.ts`   | `e1f748ead5af30808f6aaf7abafc9491589df02c988e995becc77690fbea6c88` |
| `packages/engine-adapters/src/remotion/discovery.ts`    | `2550560c5f6deed72912713f820ebde0cb47224fee3d6633911e2b19f660e34b` |
| `packages/engine-adapters/src/remotion/player-host.ts`  | `fb9369a6a2f5ea94a3322e17d339935feb04af34bf6e6f4091edfe36718473e0` |
| `packages/engine-adapters/src/remotion/node-runtime.ts` | `f7c538e56db59e07ac32d2b3986395789fb8618f6c3e4f81d2d78470f966155f` |
| `packages/engine-adapters/src/remotion/renderer.ts`     | `d9436d6b42fce684d75c96fe85c071a80f7f11ef103f188628865c35f1ddb76c` |
| `packages/engine-adapters/src/remotion/dependencies.ts` | `8ff9775bfe7fbd27126fda59f3b42b846e70600d8b8fb5436a9339bf7e4ca584` |
| `tests/integration/remotion-real-runtime.test.ts`       | `468a9420502a04fec65dcf64d30a3db34d4d3d1912151cf673a4ba24169e7305` |
| `scripts/validate-p10-remotion-contract.mjs`            | `b82f8d2c9f28d79969835f4ba8b457002f137fa1f8b15ef00f56af15a22500a3` |
| `pnpm-lock.yaml`                                        | `6d69d13c34e78b664e6cc5719558f266c8d8617a7d18858b7623bc5121778eea` |

The gate report hashes every accepted P10 implementation and test boundary. Its stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- Remotion `4.0.489` is an adapter implementation detail. The project schema, timeline, revision model, program audio, preview scheduler, render graph, QA, and receipts remain product-owned.
- The product scheduler remains the sole project clock. A Remotion Player instance is a muted follower and cannot commit authoritative time, revisions, or fidelity claims.
- Exact still/range results record strict render identity, but P10 does not declare them final cache, QA, approval, or delivery receipts; those remain later-phase responsibilities.
- The PNG normalizer accepts only non-interlaced 8-bit RGB/RGBA and canonicalizes both to straight RGBA before hashing. Other formats fail closed rather than silently changing identity.
- Dependency collection is the accepted engine-local boundary. P20 must merge it with project, timeline, audio, effects, bridge, environment, and lockfile dependencies before final caching.
- Finishing-compositor generation proves the replaceable interface and mixed-layer code boundary. Production render-graph scheduling, alpha/color interchange, retry, cache, and receipt semantics remain later work.
- Inspector editability is conservative: complex, unschematized, unknown, or explicitly read-only props stay read-only even when Remotion itself could evaluate them.

P11 may now implement the pinned HyperFrames adapter for discovery, native preview, exact still/range rendering, media/variable dependency collection, diagnostics, inspector descriptors, and mixed-engine conformance against the accepted P09 and P10 boundaries.

# P20 acceptance — render DAG, deterministic cache, finishing, encoding, and output candidates

**Decision:** APPROVED for P21 implementation  
**Decision time:** 2026-07-16T09:59:18Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `ab77224fb8f0ab3c07ee719e9e0d1c2f34d2bb68c23077bd1fed7277b4757da8`

The P20 gate passed all 16 formal checks in one authoritative run: frozen offline install, P20.01-P20.16 contract audit, browser isolation, schema drift, lint/format/boundaries, strict compilation, 256 unit tests, 16 property/fuzz tests, 63 integrations including both real native engines, one visual-manifest test, 29 isolated-browser end-to-end tests, 26 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P20.01-P20.04 | PASS   | Serializable typed DAG contracts validate bounded resources, exact ranges, missing nodes, cycles, roots, and reachability. Dependency merger, strict/preview environment builders, and exhaustive canonical cache keys bind sources, assets, fonts, versions, frame/color/audio/browser/renderer/OS/GPU/locale/seed/lockfile/network identity.                                                 |
| P20.05        | PASS   | The content-addressed store atomically publishes artifact plus metadata, validates bytes and environment on lookup, reports hit/miss reasons, quarantines missing/corrupt truth, maintains last-use identity, and cleans only unprotected entries.                                                                                                                                             |
| P20.06-P20.08 | PASS   | Planner decisions derive from the accepted capability registry and expose native/unified/baked/fallback/unsupported/experimental paths, approximations, evidence, and blockers. Cache-aware native/shared/caption/bridge handlers enforce declared outputs. Bridge documents validate exact three-way ranges, owner, alpha/pixel/color, audio envelope, fallback, handles, and cache identity. |
| P20.09-P20.12 | PASS   | Product-owned compositor interfaces keep project files independent of implementation. The initial Remotion finishing adapter generates deterministic layered source. Exact video/audio endpoint validation, atomic FFmpeg finalization, and explicit delivery/still/thumbnail/contact-sheet/sequence/overlay/mezzanine/proxy/audio rules prevent invalid or partial outputs.                   |
| P20.13-P20.15 | PASS   | Scheduler enforces trusted/untrusted concurrency, GPU slots/exclusivity, pause/resume, cancellation, bounded retries, and resumable-node reuse. Progress cannot reach completion before artifact validation. Server receipts record the real plan, DAG, dependency/environment/cache/browser/lockfile/preflight/reproduction evidence and create only `rendered_unchecked` candidates.         |
| P20.16        | PASS   | Generated tests cover 400 canonicalization/invalidation cases. Integration proves unchanged DAG cache reuse and selective invalidation of one native branch plus its dependent finish while retaining independent caption work. Corruption, cancellation, retry, bridge duration, audio alignment, and receipt lifecycle are reproducible.                                                     |

## Authoritative render path

The accepted path is immutable revision -> dependency manifest and strict environment -> capability-backed preflight plan -> validated DAG -> cache-aware native/shared/caption/bridge/audio nodes -> replaceable master compositor -> atomic encode -> validated artifact metadata -> immutable P20 receipt -> `rendered_unchecked` output candidate. No render, cache hit, recommendation, or receipt can imply QA approval or delivery.

## Authoritative evidence identities

| Artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p20/gate-report.json`                             | `0ea498643cdd84809e0e1e4b5662ceeb758fe9d178d29f2004d22246f84db015` |
| `packages/render/src/contracts.ts`                          | `ccbd4092b0ddbf9dd41e42eb4e7611a7925074e031bad8015192d1c67022112e` |
| `packages/render/src/artifact-store.ts`                     | `5dab6d0d2c7e8a677e858c100c4e497dcc7653202981b74149915630dd7204cf` |
| `packages/render/src/planning.ts`                           | `b3b8c838dde74cb4f22c9cbd1d66cc113653d41f0cebedf1a17ed0302e32a472` |
| `packages/render/src/nodes.ts`                              | `240e8a1596a4987e9fa74c184b1afb1ed926c97af8a3f952b49a5c3f98821782` |
| `packages/render/src/bridge-scene.ts`                       | `a95f8aef53cada2be778487b9c9a7a40d1cd88bb97ed8d0d93304dfb59ab8cd9` |
| `packages/render/src/encode.ts`                             | `42e502eabd3acc1d50cfc21b9a9e6335b35b0345b0bbf68b1c55ed118ac39cf8` |
| `packages/render/src/remotion-compositor.ts`                | `4694a02ca6882df1e1257ee24621756c5306eeb01f925c1b3e865ae6efef6b17` |
| `packages/render/src/scheduler.ts`                          | `3f4f1a751d51c17caa8004bf07dd4978987bd442dd40d8dab0ea0a4826a4c066` |
| `apps/studio-server/src/render-service.ts`                  | `a0fe9c3bd87eae3e0730761b2db07f21d05050157e1ce8765560923b532488b4` |
| `tests/integration/render-dag-execution.test.ts`            | `b0a87013daebb5cf935d8bd6c6766c27168b097417392f655a73a69c77064d63` |
| `tests/property/render-cache-invalidation.property.test.ts` | `9dfe8a4f85b4bb1d9d49470c7beaa2f2e98c940702dc6541894dba6043ad499a` |
| `scripts/validate-p20-render-contract.mjs`                  | `4d42738aad11ed3f049423f388ec851fb0f8b76c6990235c67d7094c9f2615ba` |
| `scripts/run-p20-gate.mjs`                                  | `fd41c53d8bf54db6eb1bd0e7fe7fc59d7a4f9f1e1f8386fa0acf21e79c4052ba` |
| `pnpm-lock.yaml`                                            | `493dfb05b10ab41f3e40eae322e42a266acaf53c202f630de00a4fa7317716dd` |

## Controlled boundaries

- Final cache reuse is strict-environment-only unless a tested portable contract is explicitly present. Partial, missing, corrupt, or mismatched artifacts are never valid hits.
- Blocking preflight findings stop execution before expensive work. Baking, fallback, approximation, experimental behavior, trust routing, and missing dependencies remain explicit.
- Native engines remain native behind cache-aware product adapters; the master compositor remains replaceable and project documents never depend on Remotion finishing internals.
- Audio is mixed once, and its sample endpoint must equal the video frame endpoint exactly.
- Failed or cancelled encode paths never appear as completed outputs. Progress reaches 100% only after artifact validation.
- Render completion creates only `rendered_unchecked`; QA, approval, and delivery remain separate lifecycle-authorized transitions.
- Installed Google Chrome remains prohibited. UI and real-engine gates use only their validator-bound Playwright-managed binaries.

P21 may now implement delivery profiles and creation scopes, persistent queue/DAG/stage views, safe queue controls, truthful output cards, plain-language diagnostics, preflight presentation, and complete receipt export without weakening P20 cache, plan, receipt, lifecycle, or browser-isolation authority.

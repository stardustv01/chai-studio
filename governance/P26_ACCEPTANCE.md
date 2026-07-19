# P26 acceptance — performance, accessibility, and honest degradation

**Decision:** APPROVED for P27 implementation  
**Decision time:** 2026-07-16T16:11:24Z  
**Supported baseline:** personal-use macOS, Apple M4, 16 GB unified memory, arm64, local-only runtime  
**Gate identity:** `683c459a293b83ce4dc4f2120407c5cd235d9ab44bc5372ccb506cd4abe77c6b`

The P26 gate passed all 18 formal checks in one authoritative run: frozen offline install, P26.01-P26.11 contract audit, fresh local benchmark, 16 focused fixtures, browser isolation, schema drift, repository-wide lint/format/boundaries, strict compilation, 305 unit tests, 20 property/fuzz tests, 75 integrations including both real native engines, one visual-manifest test, golden checksum groups, 39 isolated-browser end-to-end tests, 34 reviewed macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                              |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P26.01-P26.02 | PASS   | One honest M4/16 GB hardware class, eight project classes, 224 local benchmark samples, and a bounded browser instrumentation vocabulary cover startup, open, transport, interaction, capture, proxy/render, memory/GPU/disk, and cache metrics. |
| P26.03-P26.04 | PASS   | Immutable snapshot identity reuses derived indexes, revision diff has exact reference fast paths, and the timeline virtualizes visible rows with memoized projections while retaining whole-project validation.                                  |
| P26.05-P26.06 | PASS   | Existing bounded preview, proxy, worker, and cache correctness contracts remain authoritative; cache lookup telemetry never substitutes for content validation.                                                                                  |
| P26.07        | PASS   | The visible reversible ladder reports dropped frames, lowers quality, disables expensive preview effects, and routes to exact range rendering without claiming frame-perfect real time.                                                          |
| P26.08        | PASS   | Shortcut search, editing, conflict rejection/resolution, import/export, reset, persistence, and keyboard routing pass unit and E2E coverage.                                                                                                     |
| P26.09        | PASS   | Screen-reader summaries, focus restoration, high contrast, reduced motion, scalable text, and non-color-only indicators pass the reviewed UI matrix.                                                                                             |
| P26.10-P26.11 | PASS   | All nine deterministic stress scenarios retain stable authority with bounded checkpoints; eight class p95 budgets and the 1.15 regression ceiling are frozen for the supported environment.                                                      |

## Authoritative performance path

The accepted path is detected hardware -> frozen fixture identity -> authoritative snapshot construction -> local measurement -> deterministic percentile summary -> class-specific budget -> blocking gate evidence. A different machine is not relabeled as this support class, and no performance telemetry is uploaded.

## Authoritative evidence identities

| Artifact                                    | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p26/gate-report.json`             | `48dc53408d15ac9af7db529c61ca8371ad30babc0fdd9bdd6907a2588f1fa752` |
| `evidence/p26/benchmark-report.json`        | `aa9f3e42d328704e8658c0eb68897d19ea727771309a98dc9ca5ed1a6a773b59` |
| `fixtures/performance/project-classes.json` | `c8379cfcc39e40733ad14d612ddca21c37372b15e103b815933d406f83fe0d73` |
| `fixtures/performance/budgets.json`         | `c1adae587797aa0d4217b80a05e24e03e086dbdba83a7e50f53068d0fbdc2a06` |
| `packages/diagnostics/src/performance.ts`   | `5b4b86836d22ca04b5d23efa1664aaf4b0811e3510dbe62ef136e9cf1a26ce43` |
| `packages/diagnostics/src/stress.ts`        | `aaa2cbb26d66a1a9801e71d54c26d6580ce36ba803cd90b4dbf207503f6ab88d` |
| `packages/preview/src/degradation.ts`       | `989b48b78b7bb85ae5446cbf8334219cb36f764c62489ce49446f9b30a6a4b72` |
| `apps/studio-web/src/shortcut-profile.ts`   | `476e453a22c9131fd5140749831c08018d0d653bf6180b455776d64166bb6015` |
| `apps/studio-web/src/accessibility.ts`      | `18ec606f4a41018633544c39d5815a089365acc31536be3f50cf6f7cabb76875` |
| `docs/PERFORMANCE_ACCESSIBILITY.md`         | `7b3023da9d35cf65a400911e9f4dee3acad145dfe27d03220ed6767bab6a6827` |
| `scripts/run-p26-gate.mjs`                  | `0caebd957fcb704410646d62207db0ff626397bae7f989f09ca82d370520acc9` |
| `pnpm-lock.yaml`                            | `a66f716908a777c3e305d2d4fa7c0c455586fc1990ad94656e6148606077f25c` |

## Controlled boundaries

- The production support claim is the measured M4/16 GB class only; other hardware is unverified, not implicitly supported.
- Optimization may reduce cost but cannot weaken exact frame/rational/sample output, immutable revisions, cache correctness, deterministic capture/render, recovery, containment, QA, or delivery authority.
- Degradation remains visible and reversible. Rendered output is authoritative whenever interactive preview cannot meet budget.
- UI tests remain bound to `playwright-managed:chromium-1228`; real-engine gates remain bound to `playwright-managed:chromium_headless_shell-1228`. Installed Google Chrome and persistent user profiles remain prohibited.

P27 may now package, diagnose, document, install, preserve, upgrade, and qualify the local product without introducing a desktop wrapper or cloud dependency.

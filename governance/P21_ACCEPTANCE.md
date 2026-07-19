# P21 acceptance — delivery profiles, render creation, queue, outputs, diagnostics, and receipts

**Decision:** APPROVED for P22 implementation  
**Decision time:** 2026-07-16T10:29:13Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `7581856c9dd051ebb7782c3546b09a7deafdee94f0f2ca30fe64d1fce7d76190`

The P21 gate passed all 16 formal checks in one authoritative run: frozen offline install, P21.01-P21.10 contract audit, browser isolation, schema drift, lint/format/boundaries, strict compilation, 259 unit tests, 16 property/fuzz tests, 64 integrations including both real native engines, one visual-manifest test, 30 isolated-browser end-to-end tests, 27 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                                          |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P21.01        | PASS   | Eleven built-in profile classes and project-persisted custom profiles carry validated dimensions, rational FPS, output kind, container/codecs, audio rate, color, alpha, original/proxy policy, strict-environment policy, bounded output template, and canonical identity.                                  |
| P21.02        | PASS   | Full timeline, I/O, selected range, clip, single frame, and named-version scopes enforce non-negative exact frames and non-empty half-open ranges. The server reruns preflight against the immutable expected revision before enqueue.                                                                       |
| P21.03-P21.04 | PASS   | Render requests and job projections are atomically persisted below `renders/queue`. Queue views expose job/revision/range/profile/priority/order/status/stage/engine/cache/progress/estimate/QA truth and classify nonterminal work as restart-interrupted instead of inventing completion.                  |
| P21.05        | PASS   | Cancel, failed/restart-interrupted retry, duplicate, queued reprioritize, and terminal-history cleanup are availability-gated. Pause/resume remains visibly disabled because the connected worker has no proven cooperative checkpoint; the UI cannot claim a false pause.                                   |
| P21.06-P21.07 | PASS   | Output cards project current lifecycle state, dimensions/FPS, artifact size/path/hash, source revision, receipt identity, and explicit native-shell availability. Diagnostics show the correlated error plus selected job/stage/worker and repair text. No unchecked output is called approved or delivered. |
| P21.08-P21.09 | PASS   | Preflight presents missing dependency, unsupported capability, rights, original/proxy, disk, scope, and preview-only findings. Human receipt identity and complete immutable JSON remain visible beside explicit QA/approval/delivery separation.                                                            |
| P21.10        | PASS   | Unit, restart integration, API lifecycle, functional browser, and reviewed macOS golden tests cover profiles, custom profile persistence, preflight, exact scopes, queue survival, safe controls, output truth, and receipt rendering.                                                                       |

## Authoritative delivery path

The accepted path is selected validated profile + exact render scope + immutable expected revision -> centralized delivery preflight -> atomically persisted request -> server job projection -> P20 render DAG -> validated output candidate -> current lifecycle projection -> human/JSON receipt. Restart can interrupt execution, but it cannot erase the request or turn an interrupted job into success.

## Authoritative evidence identities

| Artifact                                                                          | SHA-256                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p21/gate-report.json`                                                   | `1c0203118805d791b33f7c1faf3b4f38bb598e2cc89a8fb261479353303a5afd` |
| `packages/render/src/delivery.ts`                                                 | `112140815e88e29b232749f809d38f5a39f41ab19932864439562c5f266abf02` |
| `apps/studio-server/src/job-registry.ts`                                          | `86934247fbe9b19639fa670ae9ec0a4b1832fa7eb1c520be3281bc294f3a37f5` |
| `apps/studio-server/src/render-service.ts`                                        | `18c429efc5be79d13f84f34208505830021c6ae47c219f7d6e3d4ea0fac4258a` |
| `apps/studio-server/src/index.ts`                                                 | `92c2f6a6062bbee311b63fa2c902f05effd2eb818d4427e9b2276076b70f891f` |
| `apps/studio-web/src/delivery-workspace.tsx`                                      | `9b466a8434338bff7ac3ea337e38a3d30fed713de26e4b2b59150ca6b6a80d98` |
| `tests/integration/server-render-api.test.ts`                                     | `b5b4a41441bd55099fc701a9eb1663156d2c58a59167eb88d1fb19f95b4ce930` |
| `tests/e2e/delivery-workspace.spec.ts`                                            | `7369a4f3eb1873b35df6d5f658e251679f0bf79d95cca86e37c5e74c0796c870` |
| `tests/e2e/delivery-workspace.spec.ts-snapshots/p21-deliver-authority-darwin.png` | `793f325089967b79e5146fcf0405e421ab817c2c4bdd1997be995ebee591077e` |
| `scripts/validate-p21-delivery-contract.mjs`                                      | `56ea8a8bd87c88f68c29fce20a08eb0bcdfd765dd62a7debe5648fe6640972bc` |
| `scripts/run-p21-gate.mjs`                                                        | `cd28b2152959db20586accc2c59549ee06cb6c9fdc923c6fc9883fdf29ad6a84` |
| `pnpm-lock.yaml`                                                                  | `493dfb05b10ab41f3e40eae322e42a266acaf53c202f630de00a4fa7317716dd` |

## Controlled boundaries

- Project custom profiles cannot replace built-ins and must validate a fresh canonical identity before persistence.
- Preflight blockers stop enqueue. Preview profiles explicitly retain proxy-only warning truth and cannot become final-source evidence.
- Queue cleanup removes terminal queue history only; immutable outputs and receipts remain.
- Restarted queued/running work is reported as interrupted and retryable, never silently resumed or completed.
- Pause, file open/reveal, and comparison controls remain unavailable until their cooperative worker or native macOS bridge contracts are implemented and tested.
- Output lifecycle is re-read from immutable receipt events. `rendered_unchecked`, QA, approval, and delivery remain distinct.
- Installed Google Chrome remains prohibited; the P21 UI gate used `playwright-managed:chromium-1228` and real engines used `playwright-managed:chromium_headless_shell-1228`.

P22 may now centralize versioned QA rules/results, pre/post-render structural/audio/visual/caption/sync checks, strict and perceptual fidelity comparison, lifecycle enforcement, checklist evidence, scoped exceptions, and delivery-bypass security tests without weakening P20-P21 render, preflight, queue, receipt, or lifecycle truth.

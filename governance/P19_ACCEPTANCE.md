# P19 acceptance — review workflow, exact A/B comparison, approvals, and version stacks

**Decision:** APPROVED for P20 implementation  
**Decision time:** 2026-07-16T09:30:17Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `e9ba4040c48539e2654458d7dc00205b76a43f64116bdb2d9ff65065f01a8a18`

The P19 gate passed all 16 formal checks in one authoritative run: frozen offline install, the P19.01-P19.09 contract audit, browser-isolation enforcement, schema drift, strict lint/format/boundaries, strict compilation, 241 unit tests, 14 property/fuzz tests, 62 integrations including both real native engines, one fixture visual test, 29 isolated-browser end-to-end tests, 26 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                  |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P19.01-P19.03 | PASS   | Strict, versioned review state binds bundles and issues to immutable revisions, exact half-open ranges/frames, captures, annotations, origin evidence, actors, comments, and recorded transitions. Creation and lifecycle changes execute through reversible `review.edit` commands. |
| P19.04        | PASS   | Exact revision A/B comparison validates one timeline, rational FPS, common range, two immutable revision identities, split/wipe/difference modes, linked navigation, and capture-manifest export. Approximate-second alignment is absent.                                            |
| P19.05        | PASS   | Named version stacks and alternate takes reference immutable revisions plus stable clip/source IDs without duplicating authoritative media. One active take is enforced per stack and switching remains reversible.                                                                  |
| P19.06-P19.07 | PASS   | Review requests, recommendations, actions, and scoped accepted exceptions preserve actor, evidence, comment, revision, expiry/review date, and audit identity. Review actions explicitly have no QA lifecycle authority and cannot imply approval or delivery.                       |
| P19.08        | PASS   | The accepted Inspect surface contains the authoritative review desk, exact issue input, revision/QA truth, comparison contact sheet, parity identity, capture-manifest export, and source reveal while retaining the P18 Codex context surface.                                      |
| P19.09        | PASS   | Unit, generated-range property, HTTP integration, reopen, audit, undo/redo, real-engine, and macOS browser tests reproduce the lifecycle, comparisons, exceptions, alternate takes, and no-false-approval boundary.                                                                  |

## Authoritative review path

The accepted path is immutable project revision -> strict `TimelineDocument.reviewState` -> `review.edit` command -> validated review operation -> new immutable revision -> regenerable API/UI projection. Capture comparison views remain non-authoritative records under `captures/comparison-views.json`; exact revision A/B authority exists only in timeline review state.

Review requests and actions are evidence records, not lifecycle transitions. Only the frozen QA lifecycle service may promote an output candidate to approved or delivered. Accepted exceptions are narrow, evidence-bound, dated, and revalidation-visible; they do not suppress unrelated or future failures.

## Authoritative evidence identities

| Artifact                                                                       | SHA-256                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `evidence/p19/gate-report.json`                                                | `9b366ca01cf1b254ae69ca3171cdd83a0496bf507170fa0a5c63966bf4fef53c` |
| `packages/review/src/index.ts`                                                 | `4fb3293f5217810d1a6db472ef9c032dce2a28d392a62d22bb79dd77c263c8d5` |
| `packages/schema/src/project-documents.ts`                                     | `47b372dab834e2afa37ed0cf0b9000d9dbb07cdb32d721649a10de8da0113265` |
| `packages/schema/src/command-engine.ts`                                        | `8c23d4fc1cee43ade81c5e6e8763f86f60dbec291840552a99021049e9250828` |
| `apps/studio-server/src/review-service.ts`                                     | `0ae389991304a91c3a5203a66f33fdd474a807a5c1da345d2f204abcd89a3399` |
| `apps/studio-server/src/interaction-service.ts`                                | `55a9141e3c844023ac123cd2edd66ef568b74e2c7ee85fb47fbd66f0db14733c` |
| `apps/studio-web/src/review-workspace.tsx`                                     | `81b8c1968289e3c6eecef2729ef2d9ac7845324158b0b51ac0e4581b0c6aca78` |
| `tests/unit/review-core.test.ts`                                               | `81e89ab49704d5cd26d0b9236ed33a3e6c2900413f849782d65ea01ee5829ad5` |
| `tests/property/review-ranges.property.test.ts`                                | `9b6431ffef8fe31701620fb3ef5cf917cdc8b722bbe05e46935186a64796f3f5` |
| `tests/integration/server-review-api.test.ts`                                  | `fbc49a8ddf5c5fc4a6df6768404bda3e9786ae81a0d47c06ad772bdaa400b0f2` |
| `tests/e2e/review-workspace.spec.ts-snapshots/p19-review-workspace-darwin.png` | `4844fe1415aa2fa55705849061335c37e4e8f50b0e79ad586e3995a322306d2e` |
| `scripts/browser-isolation.mjs`                                                | `97b3ce86f0285e43188e1926a24502a9ae7833af495af29836fe8102cf4d636f` |
| `scripts/validate-p19-review-contract.mjs`                                     | `34350fdaabec7a160b2ceb645af12f064ceec720761e7841676d3a816ff519d6` |
| `scripts/run-p19-gate.mjs`                                                     | `97463762d29d1c70e59838618f4611c66435b05514d2c4220bf48a27bb917676` |
| `pnpm-lock.yaml`                                                               | `ac3ee6955e758b33823862c689577e1d4ce5f3684d48f8629f118e3cf36a18c2` |

The gate identity binds platform, architecture, Node, lockfile, review schema, all accepted implementation hashes, Playwright-managed UI Chromium, Playwright-managed headless engine Chromium, and every gate outcome. Installed Google Chrome was not selected and persistent user profiles were not configured.

## Controlled boundaries

- `TimelineDocument.reviewState` is the only authoritative review/issue/exact-comparison/version-stack source. Capture views and UI projections cannot compete with it.
- Every comparison is revision- and frame/range-exact on one timeline and rational FPS. Approximate time alignment remains forbidden.
- Review actions may recommend or request but cannot approve, deliver, or bypass required QA evidence.
- Alternate takes reference immutable revisions and stable clip/source IDs; they never duplicate or silently replace authoritative media.
- Exceptions remain scoped, reasoned, evidence-bound, approved by an identified actor, and dated for expiry or review.
- Server shutdown must unsubscribe and drain queued context-manifest writes before project directories are released.
- UI browser tests use Playwright-managed Chromium; real Remotion and HyperFrames gates use the dedicated Playwright-managed headless shell. Installed Google Chrome remains prohibited.

P20 may now implement the typed render DAG, dependency/fingerprint/canonical cache identity, content-addressed artifact store, planner/preflight, native/shared/caption/bridge render nodes, replaceable master compositor, deterministic audio/encode/output nodes, scheduling/progress, output-candidate pointers, and selective-invalidation/reproducibility tests without weakening any accepted revision, capability, review, QA-lifecycle, cache-truth, or browser-isolation boundary.

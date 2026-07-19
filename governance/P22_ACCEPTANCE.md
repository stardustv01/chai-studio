# P22 acceptance — centralized QA, fidelity evidence, lifecycle authority, and delivery control

**Decision:** APPROVED for P23 implementation  
**Decision time:** 2026-07-16T12:16:57Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `420e66292820114aebb78f10615d1406058926b1138f71be979dd074c7798da6`

The P22 gate passed all 17 formal checks in one authoritative run: frozen offline install, P22.01-P22.14 contract audit, normalized-pixel and measured perceptual fixture verification, browser isolation, schema drift, lint/format/boundaries, strict compilation, 268 unit tests, 16 property/fuzz tests, 65 integrations including both real native engines, one visual-manifest test, 31 isolated-browser end-to-end tests, 28 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P22.01-P22.02 | PASS   | One versioned QA rule/result contract and 22 centralized rules drive pre-render parity, API results, Deliver UI, receipts, and lifecycle decisions. Fourteen pre-render rules are mapped from delivery preflight without a second policy source.                                                                                              |
| P22.03-P22.04 | PASS   | Structural output and measured audio evaluators verify immutable artifact bytes, readability, dimensions, rational FPS, duration, frame count, container/codecs, audio presence/layout/rate/channels, clipping, true peak, loudness, silence, and synchronization evidence.                                                                   |
| P22.05-P22.08 | PASS   | Reviewed native-engine, mixed-boundary, caption, alpha, shader, transform, and comparison goldens are normalized to RGBA8 linear Rec.709. Same-environment repeats require exact normalized-pixel hashes; cross-environment comparison uses a fixture-measured normalized RMSE threshold of `0.121633` for an observed `0.12163278321771313`. |
| P22.09-P22.10 | PASS   | Caption and synchronization checks carry exact frame/sample deltas, entity/range locations, evidence hashes, thresholds, environment identity, and repair guidance.                                                                                                                                                                           |
| P22.11        | PASS   | Lifecycle transitions are exclusively constructed by the project service. Generic command submission rejects lifecycle mutation, matching output/report identity is mandatory, and a changed output requires a new immutable output identity before QA can be invalidated.                                                                    |
| P22.12-P22.13 | PASS   | Every output receives an exact ten-item human review checklist with evidence-backed records. Approval requires a matching passing/warning report plus a complete checklist; warning approval additionally requires valid scoped, dated exceptions that cannot cover unrelated findings.                                                       |
| P22.14        | PASS   | Unit, authority integration, server API, and browser tests prove bypass rejection, valid transitions, checklist evidence, approval/delivery identity, clipped-audio failure, structured findings, and truthful unavailable UI controls.                                                                                                       |

## Authoritative QA and delivery path

The accepted path is centralized preflight -> immutable render candidate -> centralized post-render machine QA -> exact ten-item human evidence checklist -> explicit approval of the matching immutable output -> delivery record. Rendering, encoding, a partial checklist, or a subset of passing checks can never imply approval or delivery.

## Authoritative evidence identities

| Artifact                                                                       | SHA-256                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `evidence/p22/gate-report.json`                                                | `ab0a49aad7dcb00447fa81e057c6174547a785467746e76c4187038a4a407abe` |
| `packages/qa/src/contracts.ts`                                                 | `9e4d311cb29b973baff430745624804d470c85e0d56246bae878284b3190c102` |
| `packages/qa/src/rules.ts`                                                     | `74e92513fb8fa1524ea635577b4f2537e2f451109877080af7c3d9763e5ed992` |
| `packages/qa/src/preflight.ts`                                                 | `99ec217446a685edae0f3a224fc762e6362e4cc3845a0d7ef8d25454b0f9cd61` |
| `packages/qa/src/evaluators.ts`                                                | `d06f1733f679860a38a7ab96161ef1d222c96d4dea57fc204c184b1ec75bb109` |
| `packages/qa/src/visual.ts`                                                    | `9e853f06ada25f988e3f4f65c918fd50bc2b11d79c4f91da271dc954f5f4aba5` |
| `packages/qa/src/lifecycle.ts`                                                 | `27dd83fd82016bca3fc8c3eb85178da9f94c6b505c64c2034e1e25789cc30646` |
| `apps/studio-server/src/project-service.ts`                                    | `4601c3551ef6c458d08db4f158f0a22ec119e8447c88b9e58e031c9e2d77a61c` |
| `apps/studio-server/src/render-service.ts`                                     | `4490f21e72d64e304425192ea51a2fb1228f29b617eae377b5580695d05f1d62` |
| `apps/studio-web/src/delivery-workspace.tsx`                                   | `63c5506389763fb1e7a823b36fcf54aa485632d272916c5c2422de4ced5fbd45` |
| `fixtures/deterministic/qa/visual-fixtures.json`                               | `b8d6f09b408eaffbc59d312bd56897f92c67dcfb520530b101ec4147c3fe84c3` |
| `tests/e2e/qa-delivery-gate.spec.ts-snapshots/p22-qa-delivery-gate-darwin.png` | `9663f4d9728a2cdba92f014ed19096169c361cf33dd4d1a6c2b998cfe989602d` |
| `scripts/validate-p22-qa-contract.mjs`                                         | `a9bcdbcad2d802f009d5e6ad5a5ecf3fc3a9c902480ed20e7ced8b655bd991a5` |
| `scripts/validate-p22-visual-fixtures.mjs`                                     | `cc9d5cc4787f3d18bceb7c4f238abcada9e5d0ede268c97139e9e0729c51728e` |
| `scripts/run-p22-gate.mjs`                                                     | `ecdf6ccb4c5afcfbac70ed476019d4209ba5ec9f345024e2e1e5dd961ea8426c` |
| `pnpm-lock.yaml`                                                               | `2093e8c13f728ff94be1d8b9b3b3cc5d7269a2f80f274bdc1a53506ad88103a4` |

## Controlled boundaries

- QA rule/result identity is centralized and versioned; UI, API, receipt, checklist, and lifecycle code cannot redefine pass criteria.
- Strict fidelity requires the same normalized pixel hash only within the same environment identity. Cross-environment comparison must name a measured fixture-specific threshold and evidence hash.
- Output mutation cannot reuse the old immutable identity or old approval. Exceptions are scoped, dated, and tied to exact findings.
- Delivery requires the matching render receipt, QA report, completed checklist, explicit approval, and current output identity.
- Installed Google Chrome remains prohibited. The P22 UI gate used `playwright-managed:chromium-1228`; real native-engine checks used `playwright-managed:chromium_headless_shell-1228`, both with temporary isolated profiles.

P23 may now harden loopback/origin/CSRF boundaries, canonical path confinement, trust and network policy, sanitized environments, browser restrictions, worker resource isolation, trusted/untrusted separation, redaction, destructive authorization, and dependency/license review without weakening P22 lifecycle or evidence authority.

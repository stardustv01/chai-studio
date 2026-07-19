# P18 acceptance — Codex context bridge, captures, annotations, and controlled mutations

**Decision:** HISTORICAL APPROVAL; CURRENT BRIDGE REQUALIFICATION IN PROGRESS  
**Historical decision time:** 2026-07-16T08:22:50Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Historical gate identity:** `4b36958e3f432eb219e89a58e43a68af423feb0e97af3e7c678ec346974d3485`

The 2026-07-16 P18 gate passed all 16 formal checks in one authoritative run. That record remains historical evidence for the accepted context/annotation foundation, but its file hashes and CLI claims are not current after the Codex control-loop completion work. It must not be cited as current acceptance until `pnpm p18:gate` produces a new passing identity.

## 2026-07-19 Codex control-loop requalification

The previously advertised render commands were not executable, `qa latest` targeted a nonexistent route, and capture required Codex to supply an external PNG. Those gaps invalidated the current reading of P18.08-P18.10 and P18.14 even though the historical gate was green.

Current implementation now provides one public `chai-studio` binary with a typed discovery-to-handler invariant, owner-private live-instance attachment, a distinct capability-scoped bridge credential, project/media/timeline command operations, preview transport, real render planning/execution/jobs, compositor-backed exact capture, output-specific QA and receipts, artifact/source-frame export, annotations/comparisons, safe review operations, and ordered interaction events that the authenticated UI surfaces. Bridge credentials are explicitly denied approval, delivery, recorded owner decisions, and accepted-exception authority.

Targeted requalification currently passes strict compilation, affected-file lint/format, the executable P18 contract validator, the public-CLI black-box render/capture/QA/receipt/media/annotation test, secure instance-policy tests, server security/health tests, and ordered `capture.created` SSE coverage. Full P18 gate status remains pending below; no new gate identity is claimed in this document until that run completes.

The current failing requalification report is `evidence/p18/gate-report.json`, identity `5f910f1fc4edf2eee8473b0f28406e93ba1dcb6304c7d58d608ff329c32ccee7`. Frozen offline install, executable bridge-contract parity, browser isolation, and schema drift pass. The gate stops at repository-wide lint because the separately updated `design/chai-icon-system-plan/full-set-v1/source/build-icons.mjs:604` has an unused destructured `body`; repository-wide format also reports ten files under that same icon-system work. Those unrelated files were preserved. This is a release-gate blocker, not a bridge control-loop failure.

Independent current acceptance after that stop passes 137 unit/property/ordinary-integration files with 449 tests, all three isolated real native-runtime files with four tests, 67 managed-Chromium UI tests on alternate clean ports, the authenticated real-media journey, production build, security check, visual manifest, and 44 golden checks. The discovery-backed catalog currently contains 73 executable commands across 23 capabilities.

## Task acceptance

| Task          | Result    | Acceptance evidence                                                                                                                                                                                                                                                                                                                                         |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P18.01-P18.02 | PASS      | Versioned selection context identifies project/revision/timeline, selection state, master/source frames, exact timecode/rate, engine/source/props/variables/effects/transitions, nearby clips, preview truth, captures, and annotations. Every stable selection, revision, or preview-frame event refreshes `.chai-context/latest-context.json` atomically. |
| P18.03-P18.05 | PASS      | Versioned capture manifests cover interactive/fidelity, isolate, before-effects, alpha, A/B, range, and contact-sheet work. Jobs are cancelable, persist bounded project-relative outputs, bind SHA-256 ledgers, and prohibit parity claims unless provenance is the final compositor.                                                                      |
| P18.06-P18.07 | PASS      | Point, rectangle, arrow, freehand, text, and privacy-blur annotations use normalized source coordinates, category/color/author/frame-range/capture/entity authority, ordering, visibility, locking, and explicit privacy behavior. Create/update/delete run through `annotation.edit`, immutable revisions, validation, and undo/redo.                      |
| P18.08-P18.10 | REQUALIFY | The current catalog has a compile-time-complete executable handler map and black-box coverage for the public CLI, secure attachment, media, render, exact capture, QA, receipts, and capability denial. A new full-gate identity is still required.                                                                                                         |
| P18.11-P18.13 | PASS      | Source-edit begin/commit/abort remains hash-preconditioned, validated, quarantined on conflict, and context-refreshing. Bridge values/logs redact credentials and bearer material, declare no unsolicited network push, and reject stale project/revision context before work begins.                                                                       |
| P18.14        | REQUALIFY | Black-box integration now exercises public CLI -> private attachment -> project/media mutation -> real still render -> exact capture -> receipt -> QA -> UI event, while approval remains forbidden. Full P18 gate and current evidence identity remain required.                                                                                           |

## Authoritative bridge path

The accepted path is Studio selection/revision/preview state -> strict `SelectionContextManifest` -> atomic local `latest-context.json` -> scoped authenticated bridge command -> current-revision check -> existing command/source-edit authority -> immutable revision -> preview/context refresh -> capture manifest with explicit compositor provenance. Context is data, never UI scraping. Interactive output remains an approximation and can never claim final-render parity.

Annotations are part of the authoritative timeline revision, not a mutable review sidecar. Their UI is a projection over normalized documents. Creation, edits, visibility/order/privacy changes, deletion, undo, and redo all preserve actor and revision evidence through the project command history.

## Historical authoritative evidence identities

The hashes below bind the 2026-07-16 historical acceptance only. Several are intentionally stale after the current bridge implementation and must not be used as current-source identities.

| Artifact                                                                        | SHA-256                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p18/gate-report.json`                                                 | `7432bb130d9e854abef711daee0aca7a27cc152ff0348bdb7138810dc4fb9c36` |
| `packages/bridge/src/manifests.ts`                                              | `bd7fc14aca08679a30c8c7c6dfdc3dec8ec2e5ac8c14d35132d53df0364b6ad3` |
| `packages/bridge/src/capture-jobs.ts`                                           | `bfe564211162688d4aef44cdd580ad50385a92beb5c1de8388970407efc7c8b3` |
| `packages/bridge/src/annotations.ts`                                            | `3f66e73bb2afc4ef7f9c560f782b0791d402948f2a7d5cf86db95baee4c4613a` |
| `packages/bridge/src/cli.ts`                                                    | `a68d765228e665be153ca7ec66b08275810e4e0e552a36dd3f516ecd345893a2` |
| `packages/schema/src/project-documents.ts`                                      | `9e54fd37eca30f1d3e6bfe46489b9d4dfeb8473d6c26cee44f7e843b71874131` |
| `packages/schema/src/command-envelope.ts`                                       | `cca3a691e16ca8533ef6d7c82009e96bf45d32a91d37069e9142722eb511d0b1` |
| `packages/schema/src/command-engine.ts`                                         | `12ccc3fab74570b1235320d0565e7907491f4901d40e6043f62ce2aa3555f4bd` |
| `apps/studio-server/src/interaction-service.ts`                                 | `8cf9cefdf888b4fe41b4742181995cac3bf9d8a94a4e01c50e87340d809cb703` |
| `apps/studio-web/src/workspace-content.tsx`                                     | `f4e27d5d331d28da39a24131586c28b73ca5214fa3665352b27322074a20d307` |
| `tests/unit/bridge-context-capture.test.ts`                                     | `1694a49eb84ce608eedccdea8508a5ac1dbbe01b73b3c6772543b24aaeeed741` |
| `tests/integration/server-interaction-api.test.ts`                              | `c05fd339306ec05ebb61fee8c9a2320274e9936239084e2c5198d2cad6dca250` |
| `tests/e2e/studio-visual.spec.ts-snapshots/p18-codex-context-bridge-darwin.png` | `9bf400c0b9d6c04e296dc091b01a97ef4a0a3bfc82bdaed40616ef1d4b542e67` |
| `scripts/validate-p18-bridge-contract.mjs`                                      | `5866df84419f47ced9afebec8ed81f1b6431a873c513b01e541a31d63bd19a94` |
| `scripts/run-p18-gate.mjs`                                                      | `72f660d8294b0a2ac337257b0584f3d1e439f195a79087e9fb062d32194eb242` |
| `pnpm-lock.yaml`                                                                | `436b4eaaad554a5381458e740d387a29866f85dbefb3ad1da1bcd8900703e37a` |

The gate report hashes the accepted implementation, schemas, tests, UI goldens, browser-safety boundary, and lockfile. Its stable identity binds platform, architecture, Node, manifest schema versions, Playwright-managed browser executable/identity, implementation hashes, and all gate outcomes.

## Controlled boundaries

- Context must remain revision-bound, machine-readable, atomic, and independent of UI scraping. Stale project or revision context is refused rather than repaired implicitly.
- The bridge is local and Codex-facing only. It may never create a second conversation surface, infer approval/delivery, or push unsolicited content to a remote service.
- Installed Google Chrome remains prohibited. All browser work must pass isolation and resolve to Playwright-managed Chromium with temporary profiles.
- Interactive capture and final-compositor fidelity remain visibly and structurally distinct. Only final-compositor artifacts may be parity eligible; every output remains hash/provenance bound.
- Annotation authority remains inside immutable project revisions. Review files may index or project it but cannot become a competing source of truth.
- Privacy blur behavior applies to both preview and export; secrets and credentials remain redacted in logs and diagnostic output.
- Source edits keep begin/commit/abort transaction boundaries, expected hashes, validation, quarantine, cache invalidation, receipts, and authoritative context refresh.
- P19 review/approval surfaces may request or record decisions, but cannot weaken the frozen QA lifecycle or infer approval/delivery from review activity.

P19 may now implement review bundles, issue lifecycle, exact A/B revision comparisons, version stacks and alternate takes, review/approval requests, scoped accepted exceptions, the contract-backed review workspace, and reopen/audit coverage without weakening any accepted context, capture, annotation, revision, QA-lifecycle, privacy, or browser-isolation boundary.

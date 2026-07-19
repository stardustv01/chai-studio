# P05 acceptance — framework-independent timeline core

**Decision:** APPROVED for P06 implementation  
**Decision time:** 2026-07-15T11:55:07Z  
**Supported baseline:** personal-use macOS, local self-contained project folders  
**Gate identity:** `2c7020a0d241dec71cb9954e89d2d24ab7f0f1b9362b7ccb36c81d8db4192f3c`

The P05 gate passed all 10 formal checks: frozen offline install, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and visual regression tests, golden verification, and the production build. The accepted repository has 77 unit tests, eight property/fuzz tests, 32 integration tests, and one visual golden test. Timeline fuzzing alone executes 600 generated cases per gate across split, trim, ripple-delete, interval queries, snapshot serialization, selection retention, and nested rational mappings.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                    |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P05.01 | PASS   | Versioned immutable snapshots model stable tracks, clips, nested sequences, transitions, bridges, captions, audio buses, markers, automation, keyframes, selection, and in/out ranges.                                 |
| P05.02 | PASS   | Bounded signed bigint master frames and positive half-open ranges own persisted edit positions; boundary helpers reject negative persisted frames, empty ranges, and overflow.                                         |
| P05.03 | PASS   | Normalized rational transforms provide explicit floor/ceil/nearest mapping, inverse and nested composition, source-rate/speed handling, and display-only drop-frame timecode.                                          |
| P05.04 | PASS   | Ordered track and audio-bus registries validate kind constraints, unique order, mute/solo/visibility/lock state, audio routing, and deterministic visual/audible order.                                                |
| P05.05 | PASS   | Clip placement validates track ownership, non-audio overlap, source handles, exact-one source identity, nested duration/rate boundaries, transitions, and stable relationships.                                        |
| P05.06 | PASS   | Snapping collects playhead, guide, marker, clip edge, caption, transcript phrase, and keyframe candidates with frozen priorities, per-kind toggles, thresholds, and deterministic tie-breaking.                        |
| P05.07 | PASS   | Pure commands cover stable multi-selection, move/nudge, insert/overwrite/replace, duplicate, clipboard paste, grouping/linking, caller-supplied identity, locks, and exact snapshot inverses.                          |
| P05.08 | PASS   | Blade/split, trim/ripple-trim, lift/delete/ripple-delete, and persisted in/out commands preserve exact source mapping, handles, linked coverage, lock policy, keyframe ownership, marker policy, and undo.             |
| P05.09 | PASS   | Audited commands add/update/remove/reorder tracks and rename or merge/replace clip metadata; destructive track removal requires explicit intent and normalized order.                                                  |
| P05.10 | PASS   | Stable note, issue, chapter, approval, and guide markers validate category/severity/annotations, expose frame navigation order, and obey documented anchored-time/content ripple behavior.                             |
| P05.11 | PASS   | Keyframes validate owner/lane reachability, property/value/tangent/frame bounds, interpolation, shared/native authority, and native-preservation flags; clip edits migrate owned frames.                               |
| P05.12 | PASS   | Rebuildable indexes cover clip intervals/order, visible and active layers, nearby context, asset/nested/group usage, transcript phrases, render dependencies/dependents, markers, entity kinds, and normalized search. |
| P05.13 | PASS   | Every edit returns a concise history label, operation-aware explanation, affected stable IDs, and deterministic entity/field-level added/removed/modified diff.                                                        |
| P05.14 | PASS   | Property/fuzz suites exercise randomized ranges, split/trim/ripple invariants, inverses, nested mappings, selection retention, interval equivalence, and byte-stable serialization.                                    |
| P05.15 | PASS   | The package publishes its timeline contract, safe-usage guidance, canonical serializer, full exports, and an executable linked A/V fixture with markers, bus routing, automation, and keyframes.                       |

## Authoritative evidence identities

| Artifact                                   | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `evidence/p05/gate-report.json`            | `67a55b5370088bf20c8f5736d6342f3ed144393aa7cb05221f92e6729dca4f22` |
| `packages/timeline/src/model.ts`           | `2590fd465add9da6ecd2c4c16614f3b3e1c8872ef8579fe927253684e24380af` |
| `packages/timeline/src/commands.ts`        | `93af75721d96007e1836e8f1d56018cef1ed26dcce76e4dacd3904816d4c1015` |
| `packages/timeline/src/derived-indexes.ts` | `73c69f998371bcc7b07628d3940bbce30ebeab12e2e52b67df32864709e8772a` |
| `packages/timeline/src/serialization.ts`   | `9d3be7bcbede3c415d9c55c5f814a4a87fab59e5227b6b58d8225bb7e5f7a86d` |
| `packages/timeline/src/fixture.ts`         | `cda1505506dd97f0f5d3034fcb7aaf4c64caf5fd1c56220c44dec65fa761a585` |
| `pnpm-lock.yaml`                           | `1b7cae1b7c3ad71a37c7795f58d2256fe586deba126e06691241eea059e9fb03` |

## Controlled boundaries

- P05 owns framework-independent editing semantics. Remotion, HyperFrames, preview, and render adapters must consume this contract and cannot create competing timing or identity authority.
- Derived indexes, transcript phrase inputs, render dependency graphs, thumbnails, waveforms, and other caches are rebuildable. Only accepted project revisions remain authoritative.
- Snapshot serialization is a versioned internal compatibility format. P06 asset registry work continues to use `assets.json` as frozen by P04; media probing and proxies must not leak into timeline authority.
- Split currently refuses keyframes on the right side unless the caller supplies a future explicit remap command. It never guesses animation ownership.

P06 may now implement secure hash-based assets, media inspection, proxies, generated views, fonts, search, relink, rights, and delivery preflight hooks while preserving the P04 revision contract and P05 timeline contract.

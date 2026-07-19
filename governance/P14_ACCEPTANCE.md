# P14 acceptance — Multitrack timeline UI and editing

**Decision:** APPROVED for P15 implementation  
**Decision time:** 2026-07-15T19:31:51Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `1194e89f052ee746fbcb7385f4a7f172a8840d0c5c6fcd6e51c90d933b98aaab`

The P14 gate passed all 15 formal checks in one authoritative run: frozen offline install, the P14.01-P14.16 contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, ordinary integration plus sequential real Remotion and HyperFrames runtimes, visual-manifest regression, fixture golden verification, Chrome behavior and UI-golden checks, production build, and security inspection. The accepted repository has 203 unit tests, 10 property/fuzz tests, 52 integration tests including both real native engines, one fixture visual test, 18 Chrome end-to-end tests, and 19 macOS UI goldens including two P14 timeline goldens.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P14.01 | PASS   | Timeline rows are truly virtualized from the authoritative track list; large stacks render only the visible slice while the ruler and track headers remain pinned. |
| P14.02 | PASS   | The ruler, playhead, markers, and in/out range use integer master frames and rational/drop-frame timecode. Horizontal and vertical scrolling preserve alignment.   |
| P14.03 | PASS   | Add, remove, rename, lock, mute, and solo track actions dispatch typed timeline commands rather than mutating component state.                                     |
| P14.04 | PASS   | Clips display authoritative engine, waveform, keyframe, bridge, warning, range, name, and metadata cues without claiming unsupported fidelity.                     |
| P14.05 | PASS   | Single, additive, range, and keyboard selection resolve through `selection.set`; focus and accessibility state remain explicit.                                    |
| P14.06 | PASS   | Pointer drag and integer-frame nudge preview exact deltas, expose a visible snap guide, and commit one atomic `clips.move` command.                                |
| P14.07 | PASS   | Duplicate, copy/paste, group, and link operations share the P05 command surface and preserve declared affected entities.                                           |
| P14.08 | PASS   | Split/blade, trim, lift, delete, and ripple-delete remain half-open, integer-frame operations and persist through the authoritative document adapter.              |
| P14.09 | PASS   | Five-frame snapping is visible, deterministic, and applied to the same delta committed by the command.                                                             |
| P14.10 | PASS   | Track management, fit, zoom, scrolling, and pinned headers remain usable in dense timelines without replacing project authority.                                   |
| P14.11 | PASS   | Derived timeline indexes provide frame-ordered markers, entity search text, and nearby-clip queries as regenerable data.                                           |
| P14.12 | PASS   | Timeline search covers clip name, asset, engine, metadata, and warnings and reports exact matches.                                                                 |
| P14.13 | PASS   | Undo/redo labels and stacks are truthful; server mode uses revision-based history commands and resync, while contract mode uses the same command result.           |
| P14.14 | PASS   | Context menus, keyboard routes, toolbar actions, and the global command palette converge on the same typed command registry.                                       |
| P14.15 | PASS   | Unit, integration, Chrome interaction, virtualization, accessibility, and reviewed macOS visual evidence cover the complete timeline surface.                      |
| P14.16 | PASS   | Controls expose screen-reader names, pressed/selected states, groups, keyboard access, and explicit integer-authority status.                                      |

## Authoritative mutation path

The accepted path is UI intent → P05 timeline command → `timeline.edit` project command → command-engine affected-entity validation → timeline document adapter → immutable project revision → authenticated resync. Persisted selection, in/out range, markers, clip metadata, grouping, and linking round-trip through the project document schemas. The UI may calculate transient drag previews and virtualized slices, but it cannot directly mutate project authority.

## Authoritative evidence identities

| Artifact                                                | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p14/gate-report.json`                         | `d58e0171870a44c0a9378651599ceef58ad11da20bb4b5d42cb504d1dbfed472` |
| `apps/studio-web/src/timeline-editor.tsx`               | `55e7dc1a44cb1ab7aab5bbe0bc6abb9de9a7a274f5dd5ebe9dad15823d3d5595` |
| `packages/timeline/src/document-adapter.ts`             | `ad4ad2fb914a7bf7e7f4d070dfb1d4572530f7485792415f5c812b8550265dcf` |
| `packages/schema/src/command-engine.ts`                 | `427532384d345df371f0a12401613c506c82abb4e3ddaefa6db7f65e323a1c48` |
| `apps/studio-server/src/project-service.ts`             | `3574d443af5afcd9d553df7c76dd71a6dbc49cbaf6c0dfb20a8a24d244766e43` |
| `packages/engine-adapters/src/remotion/node-runtime.ts` | `d23addeb2e430a8d31b3c4c0511b48ffae5c3fccbcbd99a46420a2443d6f4465` |
| `tests/e2e/timeline-editor.spec.ts`                     | `f4adb2097cc223b0d587fc9da27f7e5ee9d118409cd4736fbd4ccf58b942588d` |
| `scripts/validate-p14-timeline-contract.mjs`            | `8038f9deaf73b273a710c98a9c1eae8d98a2551f0152dfae5408ff9f0d752d27` |
| `pnpm-lock.yaml`                                        | `bce6c8be99a0414a7169d38a032d9fcc6154319e5583aa2ea2065affeb792cc7` |

The gate report hashes every accepted P14 implementation, schema, test, and golden boundary. Its stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- Every timeline mutation must continue through `timeline.edit`, affected-entity validation, and immutable project revision commit. Component state may hold only transient interaction or explicitly regenerable view state.
- Master positions, ranges, trims, snapping, markers, and playhead values remain integer frames; persisted rates remain normalized rationals.
- Search and virtualization are derived indexes. They cannot become alternate project authority or suppress entities from command validation.
- Undo/redo must remain revision-aware and truthful. A visible label never proves a server commit; authoritative mode must resync after mutation.
- The P13 program/source monitor clocks, capture opt-in, comparison identities, and Foundation source-edit prohibition remain intact.
- The Remotion node runtime now owns its bundle server, explicitly closes each operation browser, pins range concurrency to one, disables parallel encoding, and exposes disposal. This deterministic baseline prevents renderer lifecycle races; future concurrency increases require identity coverage and stress evidence.

P15 may now implement inspector contexts, common/native properties, safe multi-selection, keyframes, capability actions, validation, dependency/cache impact, and their complete test surface over the accepted P14 selection and command boundaries.

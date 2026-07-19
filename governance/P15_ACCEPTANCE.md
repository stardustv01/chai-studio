# P15 acceptance — Inspector, native controls, and keyframes

**Decision:** APPROVED for P16 implementation  
**Decision time:** 2026-07-16T03:09:06Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `d6fbb06c7ce30f7057c71fb1221e403c472a9ddb4c863bb45275cd378108f33a`

The P15 gate passed all 16 formal checks in one authoritative run: frozen offline install, the P15.01-P15.12 contract audit, browser-isolation enforcement, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, ordinary integration plus sequential real Remotion and HyperFrames runtimes, visual-manifest regression, fixture golden verification, browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 213 unit tests, 10 property/fuzz tests, 52 integration tests including both real native engines, one fixture visual test, 22 browser end-to-end tests, and 22 macOS UI goldens including three P15 inspector/keyframe goldens.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                     |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P15.01 | PASS   | The context resolver covers no selection, clips, tracks, assets, markers, keyframes, transitions, bridges, captions, and render outputs without making staged form state authoritative. |
| P15.02 | PASS   | Common properties declare units, bounds, ownership, keyframeability, capability support, and persisted values for transform, composite, timing, and audio fields.                       |
| P15.03 | PASS   | Strict expression-free parsers, typed inputs, scrubbing, reset, mixed values, Enter commit, and Escape cancel reject partial or invalid edits before command dispatch.                  |
| P15.04 | PASS   | Remotion descriptors project validated props, calculated metadata, dependencies, source paths, warnings, and safe actions from the native adapter contract.                             |
| P15.05 | PASS   | HyperFrames descriptors project variables, tracks, adapters, timing, validation, dependencies, source paths, and explicit read-only or non-seekable warnings.                           |
| P15.06 | PASS   | Multi-selection exposes only shared safe properties, represents mixed values explicitly, and commits one atomic all-target command.                                                     |
| P15.07 | PASS   | Capability, bake, fallback, proxy, source, and bridge actions are contextual and derived from the accepted registry rather than optimistic UI inference.                                |
| P15.08 | PASS   | Keyframe add/remove/copy/paste/align/distribute/retime/navigation commands preserve integer frames, typed values, ownership, and revision history.                                      |
| P15.09 | PASS   | Linear, hold, ease, ease-in/out, cubic-bezier, value, and speed curve primitives serialize and evaluate deterministically.                                                              |
| P15.10 | PASS   | Native animation remains visibly native-owned until an explicit supported conversion command creates shared keyframes.                                                                  |
| P15.11 | PASS   | Validation, dependency identity, cache state, affected entities, and exact affected-render range remain visible before and after edits.                                                 |
| P15.12 | PASS   | Unit, persistence/reopen, mixed-selection, interaction, accessibility, browser-isolation, and reviewed macOS visual evidence cover the inspector and curve surfaces.                    |

## Authoritative mutation path

The accepted path is contextual UI intent → strict input validation → P05/P15 typed command → `timeline.edit` project command → affected-entity validation → timeline document adapter → immutable project revision → authenticated resync. Inspector drafts, scrub previews, curve drawing, and mixed-value presentation are transient UI state only. Persisted properties, ownership, keyframes, automation lanes, conversions, and selection round-trip through the project schema and command history.

## Authoritative evidence identities

| Artifact                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p15/gate-report.json`               | `c6a5eeb91db885bfe8ebedab96936987e508e7e787ead6f1265f7b9f51317ec3` |
| `apps/studio-web/src/inspector-contract.ts`   | `7d010778945155dde4c9536846e7e31c2345a65c75b5cc106171d1726b422c14` |
| `apps/studio-web/src/inspector-panel.tsx`     | `3d52e675b2e5f910a115e26de91363aa05d627a2ba29b27b1219cbd6cc5f7ef8` |
| `apps/studio-web/src/keyframe-editor.tsx`     | `fbce5edd04ed604badfef87573023a40bf315c7dd2367f74f55846bea72f94ae` |
| `packages/timeline/src/commands.ts`           | `5ab95a8fc4f2f5a76001015e9317738f17732aca5465eec6f6206f83b04cf3d1` |
| `packages/timeline/src/curves.ts`             | `f5603589fd8f8b3ec9da710682956da637b85bd3ced4c8d6372a9d72779fd45c` |
| `packages/timeline/src/document-adapter.ts`   | `928af265261be2db70f30d4a8bcdf7c09e3c18d81e0a34407751140092a6cfaa` |
| `tests/e2e/contextual-inspector.spec.ts`      | `1af3b2278465d189091a0dffdbbdc7d080f4538dfaced4850e40bc79391b1436` |
| `scripts/validate-p15-inspector-contract.mjs` | `78ec5ebd164e8b8bb2c0474eeedfe907543a9f8faf8499f2a9715a99bed61a18` |
| `pnpm-lock.yaml`                              | `bce6c8be99a0414a7169d38a032d9fcc6154319e5583aa2ea2065affeb792cc7` |

The gate report hashes every accepted P15 implementation, schema, test, golden, and browser-safety boundary. Its stable identity binds the Playwright-managed Chromium executable and identity together with platform, architecture, Node version, lockfile, implementation hashes, and check outcomes.

## Controlled boundaries

- Inspector and keyframe mutations must continue through typed commands, affected-entity validation, immutable revision commit, and authoritative resync. Local form or canvas state cannot become project authority.
- Native Remotion and HyperFrames animation stays native-owned unless a declared capability supports an explicit conversion. The UI must never imply universal generic editability.
- Master positions, keyframes, affected ranges, and split ownership remain integer-frame exact; persisted rates remain normalized rationals.
- Multi-selection commands remain atomic. Unsupported targets cause rejection rather than partial mutation.
- Dependency/cache impact is explanatory derived data; it cannot replace the authoritative dependency graph or render receipt.
- Installed Google Chrome is prohibited for tests and previews. Browser work must resolve to the verified Playwright-managed Chromium identity, use temporary isolated profiles, and pass the browser-isolation and security checks before launch-capable gates run.

P16 may now implement the authoritative audio graph, exact frame/sample mapping, preview and offline evaluators, buses and automation, explicit preprocessing, measurements, UI hooks, and its complete non-negotiable test surface without weakening the accepted scheduler, command, native-ownership, or browser-isolation boundaries.

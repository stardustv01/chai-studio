# P07 acceptance — local Studio server, API, events, and workers

**Decision:** APPROVED for P08 implementation  
**Decision time:** 2026-07-15T14:27:16Z  
**Supported baseline:** personal-use macOS, authenticated loopback-only Studio runtime  
**Gate identity:** `afe8b5df5d6edb935c4b2f6be603fa76b8b681dcfc15bf468eae119753a4be3b`

The P07 gate passed all 12 formal checks in one run: frozen offline install, server contract, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and visual regression tests, golden verification, production build, and security inspection. The accepted repository has 132 unit tests, eight property/fuzz tests, 46 integration tests, and one visual golden test.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                 |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P07.01 | PASS   | The HTTP server binds only approved loopback hosts, enforces single-instance policy, authenticates requests, validates Host and Origin, limits bodies, and rejects unsafe paths and methods with structured errors. |
| P07.02 | PASS   | Versioned JSON envelopes, correlation IDs, categorized diagnostics, strict payload parsing, and typed response helpers provide one stable client/server contract without fake-success responses.                    |
| P07.03 | PASS   | Create, open, close, snapshot, revision, lifecycle, recovery, and conflict APIs delegate to the accepted project authority and publish revision-aware events.                                                       |
| P07.04 | PASS   | Command, undo, and redo routes preserve idempotency, base-revision concurrency, declared scope, authorization, inverse commands, and immutable revision history.                                                    |
| P07.05 | PASS   | Asset import, relink, replace, query, manifest, Finder-plan, and job endpoints retain hash/path/rights authority and invalidate rebuildable caches after accepted mutations.                                        |
| P07.06 | PASS   | The preview service owns deterministic transport state, bounded preload windows, adapter diagnostics, proxy labeling, revision synchronization, and optimistic state-version checks.                                |
| P07.07 | PASS   | Selection, context, exact PNG capture, annotation, comparison, and source-edit-session endpoints retain revision identity and keep source edits quarantined until explicit acceptance.                              |
| P07.08 | PASS   | Render jobs support queue, progress, cancel, retry, output, QA, approval, and append-only receipt lifecycles while keeping encoded, QA-passed, approved, and delivered states distinct.                             |
| P07.09 | PASS   | Authenticated Server-Sent Events provide ordered sequence IDs, bounded replay, resumable subscriptions, heartbeats, correlation metadata, and explicit resync requirements after replay loss.                       |
| P07.10 | PASS   | Typed worker RPC provides request identity, progress, heartbeat, cancellation, restart supervision, crash recovery, bounded redacted logs, and predictable terminal failure semantics.                              |
| P07.11 | PASS   | A local SQLite job/asset/cache index is explicitly non-authoritative, rebuilds from project state, and can be deleted without changing project meaning.                                                             |
| P07.12 | PASS   | Disk preflight, managed temporary directories, file watching, orphan detection/quarantine, cache recovery, and idempotent graceful shutdown protect normal and interrupted runtime operation.                       |

## Authoritative evidence identities

| Artifact                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p07/gate-report.json`               | `dd3cce55bc5c9c4a9bf98b2f0b38c589793fcc6199e8d60b2ebcac54e1705e4b` |
| `apps/studio-server/src/index.ts`             | `ba6aba72fd1fe82a61e276e75c83ec9c0938585b0ff2c4690736b9d4add4ba8b` |
| `apps/studio-server/src/render-service.ts`    | `49552269f7c21bbebbcde0598af64af5200a6ce8e3e19d0267f619bf79f1f34e` |
| `apps/studio-server/src/event-hub.ts`         | `52883586acf16e9375851df410082974689c064ee16c8b03693f2b39a060cb3d` |
| `apps/studio-server/src/worker-supervisor.ts` | `8c43c64b4634f65419b85c9a82a48625a718c9d9ee80b90c3ac4e5f44e483fe7` |
| `apps/studio-server/src/regenerable-index.ts` | `657eb29d927d58694a6bc29336b853b43893b17ae1f60b41326343124c5abef9` |
| `apps/studio-server/src/runtime-hygiene.ts`   | `ec08c3b0ec9f93fb2f7350163ed694ad32ebc42e73207403e05e875cbdee7f8a` |
| `packages/preview/src/session-state.ts`       | `3908d6d394662c22466eea29dbeb9a400226a91f2eb46d4f1dffdb24ab85bd56` |
| `scripts/validate-p07-server-contract.mjs`    | `1095f0b47c087c45e88246413d12c3ba64520871e7207d239d6a25cd6d80b94a` |
| `scripts/run-p07-gate.mjs`                    | `4546a69100187d576171b453b1d64abcae9bf09a4d864f997574922081c5174f` |
| `scripts/security-check.mjs`                  | `eb42742e9aebdc0fd12be4fdfc99e3d942dd403bb9bf8c4f73ec8a8ddf61c648` |
| `pnpm-lock.yaml`                              | `0ce5cc39ef22ee8d3e78290ecfff800e43c5a197485aa405520c6548b0d49091` |

## Controlled boundaries

- The server is a local transport layer, never a new project-state authority. Project documents, immutable revisions, commands, and lifecycle records remain authoritative.
- SQLite records, event replay buffers, previews, generated views, caches, logs, and temporary files are rebuildable runtime material. Their deletion cannot change project meaning.
- The accepted render endpoints freeze honest lifecycle semantics, but codec execution, parity, QA, delivery, and final receipt completeness remain owned by later rendering phases. Placeholder receipt fields may not be presented as final evidence.
- Worker supervision does not authorize imported executable content. P23 must enforce the accepted macOS containment contract before imported execution is enabled.
- Node's built-in SQLite API is experimental in the supported Node 22 baseline. Its use remains isolated behind the regenerable-index boundary; authoritative state never depends on it.
- All external network access and unsolicited telemetry remain denied. P08 may consume only the authenticated loopback API and event stream.

P08 may now build the Studio web shell, client state architecture, shared UI components, workspaces, panels, shortcuts, accessibility states, and local performance instrumentation on this accepted server contract.

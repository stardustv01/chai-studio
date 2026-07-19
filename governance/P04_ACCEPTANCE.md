# P04 acceptance — authoritative project model, revisions, commands, and migrations

**Decision:** APPROVED for P05 implementation  
**Decision time:** 2026-07-15T10:59:09Z  
**Supported baseline:** personal-use macOS, local self-contained project folders  
**Gate identity:** `a93555fe1d08f5fb9bcd176b4cf391af5eaf8c8da10912f521f4e1da2a5fc611`

The P04 gate passed all 10 checks from a frozen offline install through schema drift, strict lint and compilation, four automated test classes, golden verification, and the production build. The P04 implementation contributes 35 unit tests, two property tests, 32 integration tests, and the existing visual golden test. A dedicated stability test performs ten open/clean-close cycles and proves identical authoritative pointer bytes, revision hash, and semantic state with no orphan or staging drift.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                          |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P04.01 | PASS   | Canonical rational and branded bigint-string serialization normalize signs and gcd, enforce positive denominators and bounded exact integers, and cover NTSC rates in unit and 1,000-case property tests.                                                                                                    |
| P04.02 | PASS   | Source JSON Schemas and generated runtime schemas cover all nine authoritative roots plus the command envelope. Independent Ajv and runtime validation agree on valid and invalid fixtures.                                                                                                                  |
| P04.03 | PASS   | Whole-project validation reports stable entity IDs, JSON paths, codes, and repair hints for identity, reference, timing, overlap, capability, audio, source-hash, and approval errors.                                                                                                                       |
| P04.04 | PASS   | The initializer creates the canonical self-contained folder and a complete initial revision, durable pointer, autosave metadata, and Draft version without database-only authority.                                                                                                                          |
| P04.05 | PASS   | Revisions are immutable coordinated directories. Crash injection during staging, after publish, before pointer swap, and after pointer swap proves that a partial revision is never authoritative; audits expose staging and orphan state.                                                                   |
| P04.06 | PASS   | The mutation lock implements exclusive acquisition, owner/session/token identity, heartbeat, TTL, release, stale recovery under an exclusive gate, and manual-recovery policy.                                                                                                                               |
| P04.07 | PASS   | Every commit compares `baseRevisionId`; stale writers fail without rebasing and receive deterministic changed-document and stable-entity reports.                                                                                                                                                            |
| P04.08 | PASS   | A generated discriminated command-envelope schema validates command/idempotency/correlation IDs, actor/session, capability version, affected entities, scope, payload, base revision, validation-only mode, and destructive authorization.                                                                   |
| P04.09 | PASS   | Every committed revision stores parent/result revisions, envelope hash, actor/capability/scope, before/after hashes, summaries, warnings, history, lifecycle linkage, and source-edit metadata. Durable receipts provide exact idempotent replay and audit failed decisions.                                 |
| P04.10 | PASS   | Persistent source-edit begin/commit/abort sessions snapshot path/content/revision hashes, invoke pluggable validation, store diff evidence, call cache invalidation hooks, commit source content in revision authority, atomically materialize working files, repair drift, and quarantine external changes. |
| P04.11 | PASS   | Revision-contained undo/redo stacks support persistent multi-step inversion, redo invalidation after divergent edits, working-source reconciliation, and active render/export/analysis/migration barriers. Render history remains outside project history.                                                   |
| P04.12 | PASS   | Autosave supports coalesced debounce, immediate pre-risk flush, configured rotating retention, clean-shutdown markers, hash and semantic verification, recovery selection, corruption rejection, and restoration as a new immutable revision.                                                                |
| P04.13 | PASS   | Draft, Review, Approved, Delivery Candidate, and Delivered milestones link immutable revisions and output IDs. QA transition validation gates approval/delivery, and the root named-version index rebuilds from authoritative revision transactions.                                                         |
| P04.14 | PASS   | The migration registry provides deterministic 0.9→1.0 transformation, dry-run change reports, canonical backups, guarded rollback, mixed/newer/unsupported-version diagnostics, and explicit refusal to reinterpret numeric frame rates.                                                                     |
| P04.15 | PASS   | The combined crash, concurrency, command, source, undo, autosave, lifecycle, migration, and ten-cycle reopen suites pass with no state drift.                                                                                                                                                                |

## Authoritative evidence identities

| Artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p04/gate-report.json`                             | `35c2f2ebab7f442d7b8c2e477ee03fa13d07fbb4e3f82373df6d47201ab93c43` |
| `packages/schema/src/source/project-documents.schema.json`  | `9c8f65789948017fecd5b1f255f8c565a713f89976cf885948ccc7e803ce4d2f` |
| `packages/schema/src/source/command-envelope.schema.json`   | `cc1f171771607448e28393f704a6ab1031d20bd32114a732a946912066a23857` |
| `fixtures/deterministic/project-model/valid-documents.json` | `80f1bd8621fcc1d7ac57f4ec0459f45ffd2092abaafa94603bd0ec36ad718ee4` |
| `pnpm-lock.yaml`                                            | `1b7cae1b7c3ad71a37c7795f58d2256fe586deba126e06691241eea059e9fb03` |

The gate report contains per-check output, duration, environment, lockfile identity, and hashes for the twelve primary P04 implementation modules.

## Controlled boundaries

- P04 owns authoritative project state and generic command transport. Rich timeline edit semantics, ripple rules, snapping, transitions, nesting, and command-specific inverses begin in P05 and must use this command/revision layer.
- Default source validation enforces safe project scope, supported extensions, JSON syntax, hashes, and semantic project validity. Engine-specific compilation may plug into the validation callback as those adapters mature; it cannot bypass the source-edit protocol.
- Migration currently operates on a complete versioned project-document artifact with backup and rollback. P07 project-open endpoints will connect this registry to user-facing folder-open reports without changing migration semantics.
- Root autosave and named-version files are recoverable indexes. Immutable revision transactions and hash-verified autosave snapshots remain authoritative.

P05 may now implement framework-independent timeline core and edit-command semantics. Later phases must preserve exact rational timing, half-open ranges, command-only mutation, immutable revisions, and the frozen QA lifecycle.

# Frozen contract 02 — Command authorization v1

Every command declares command and idempotency IDs, actor and local session, project, correlation ID, capability/version, versioned payload, affected stable IDs, declared scope, optional validation-only mode, and `baseRevisionId` for mutations.

Authorization classes are single-valued:

- Read-only inspection and local context retrieval: automatic, read-rate category.
- Capture/review creation: automatic, capture-rate category; it cannot mutate project authority.
- Normal mutation: schema-validated, current `baseRevisionId`, mutation-rate category.
- Source edit: normal mutation rules plus an active source-edit transaction.
- Destructive delete or project-wide replacement: current base plus explicit authorization ID scoped to the operation.
- External publishing/upload: unsupported in the personal baseline.

Idempotency is keyed by actor plus idempotency ID. Exact replay returns the recorded decision/result; reuse for a different command identity fails. Stale context fails with a structured refresh requirement and never silently rebases. Audit output includes command/correlation/actor/session/project/base revision, affected entities, authorization class, result, error code, retryability, and redacted diagnostics.

Evidence: `src/command-authority.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/command-authorization-result.json`.

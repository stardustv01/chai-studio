# Chai Studio — Codex Bridge Command Contract Draft

**Status:** Draft; freeze at P02.17

## Context identity

Every selection or capture manifest declares project ID, revision ID, master frame/range, selected stable IDs, source identity, engine, preview/fidelity mode, environment/compositor identity where applicable, dependencies, and annotation references.

## Stale-context rule

A mutation whose `baseRevisionId` or referenced selection/capture no longer matches current authority is rejected with a structured refresh requirement. The bridge never silently rebases visual intent.

## Capability classes

- Read-only inspection and context retrieval.
- Capture/review jobs.
- Normal validated mutations.
- Source-edit transactions.
- Destructive or project-wide operations requiring explicit authorization.
- Publishing/uploading, which remains outside the local baseline.

## Command envelope

- Command and idempotency IDs.
- Actor and local session identity.
- Project and `baseRevisionId`.
- Capability name and versioned payload schema.
- Affected entities and declared scope.
- Validation-only option where supported.
- Correlation ID, audit fields, and expected result schema.

## Source-edit protocol

Begin snapshots paths and hashes; validate checks scope, build, dependencies, policy, and project semantics; commit records one reversible coordinated revision; abort restores or discards the working change. Unwrapped external changes remain quarantined.

## Output requirements

Human-readable and stable JSON modes, nonzero error codes, correlation IDs, redacted errors, explicit retryability, and command discovery are mandatory.

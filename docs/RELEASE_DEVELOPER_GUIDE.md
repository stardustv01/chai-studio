# Release developer guide

The monorepo separates schema, timeline, media, audio, captions, adapters, preview, render, review, QA, security, diagnostics, server, web, and shared UI packages. Package boundaries are executable. Generated schemas, capability identity, fixtures, browser isolation, licenses, budgets, and release checks are gate inputs.

An edit flows from accessible UI command to typed envelope, base-revision/authorization checks, exact transformation, whole-project validation, crash-safe immutable publish, pointer advance, ordered event, resync, and undo receipt. A render flows from exact revision/profile/scope through registry/security preflight, content-addressed DAG/cache, native/shared/caption/bridge/audio/encode nodes, atomic artifacts, QA evidence, lifecycle review, and immutable receipt.

Start with [architecture.md](architecture.md), [debugging.md](debugging.md), [fixtures.md](fixtures.md), schema sources, command registries, capability registry, worker supervisor, preview scheduler, render DAG/store, QA rules, and phase acceptances. Reproduce with exact fixture/revision/environment identity and correct the earliest failing contract.

The release pipeline verifies lockfile, schemas, all tests, real engines, visual goldens, budgets, security, licenses, production build, manifest, qualification, backup/restore, and disaster drills. `evidence/p27/release-manifest.json` traces production bytes to accepted evidence.

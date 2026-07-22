# Chai Studio execution governance

The planning authority remains the audited documents in the parent workspace. `execution-baseline.json` hashes the exact master plan, 29-phase implementation plan, task graph, cross-cutting contracts, product/schema/test/UI specifications, and five approved UI samples used for implementation.

`planning-baseline/` is an immutable verification snapshot of those same hashed artifacts for clean checkouts and protected CI. It is not an editable second authority. Local validation defaults to the parent workspace; protected CI explicitly sets `CHAI_STUDIO_PLANNING_ROOT=governance/planning-baseline` and fails closed if the snapshot is incomplete or differs from the captured hashes.

The finished-product scope is Foundation plus Professional Expansion. Cloud collaboration, public marketplace distribution, multicam, mobile editing, nodal compositing, hosted rendering, and external publishing remain outside the personal macOS baseline unless change control adds an ADR, impact analysis, migration plan, tests, and explicit approval.

Task acceptance requires code or a frozen contract, automated verification, and evidence. Rendering alone never means QA passed, approved, or delivered. A baseline change creates a new identity; old evidence is never silently reinterpreted.

The current planning baseline identity is `cd8f58b77928fa7fd439865a436bca66c433fb8d356030d8ffecf559b84fad42`. It re-identifies the security policy document's P23 verification status without changing the task graph, application scope, or release authority.

Accepted implementation records through P26 remain active. Superseded RC1 P27/P28 records are
preserved under `archive/releases/1.0.0-rc.1/` and have no authority over RC4. Fresh P27 and P28
technical records will be generated only from the committed, self-contained RC4 bundle. Final
Version 1 authority remains withheld pending qualification, informed registry audit, explicit owner
approval and signing; no technical record may infer any of those actions.

# Chai Studio

macOS-first local professional video studio operated through Codex.

## Current implementation state

Milestone 0 and phases P03-P27 are accepted. The workspace includes the authoritative editor/review/render/QA system, containment/recovery, professional editing, measured M4/16 GB performance/accessibility, and the `1.0.0-rc.1` local release layer with doctor, install/uninstall preservation, backup/restore/clone/archive, upgrade automation, examples, documentation, qualification, and disaster drills.

The current clean validation surface is 340 unit tests, 20 property/fuzz tests,
87 standard integration tests, two managed native-composition tests, separate
real Remotion and HyperFrames runtime tests, 66 isolated-browser fixture E2E
tests, one first-run E2E test, one authenticated A/V owner-journey E2E test, and
41 reviewed macOS UI goldens. V8 coverage measured 65.61% statements, 51.56%
branches, 64.00% functions, and 68.00% lines across 447 passing tests.

The replacement P28 local technical gate passed with identity
`74db0a34e17928ab946954516cf447e34e061a9c17c2a5a3caf3971284ae8941`.
Final System Acceptance and Version 1 Signoff remain **blocked** pending informed
permission for the registry vulnerability audit and explicit owner approval.
No stable release, signature, delivery authorization, or public-distribution
authority has been issued. See `governance/P28_TECHNICAL_ACCEPTANCE.md`.

## Local developer loop

```sh
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm release:validate
pnpm dev
```

The planning authority remains in the parent directory:

1. `../CHAI_STUDIO_MASTER_PLAN.md`
2. `../CHAI_STUDIO_FINAL_UPDATED_IMPLEMENTATION_PLAN.md`
3. `../PROJECT_STATE.md`

## Gate discipline

- No rich editor implementation may bypass the accepted task dependency graph.
- Every authoritative edit position uses integer master frames.
- Every persisted rate uses a normalized rational value.
- Project revisions are coordinated immutable snapshots.
- Remotion and HyperFrames remain native behind product-owned adapters.
- Interactive preview never masquerades as rendered fidelity.
- Encoding never implies QA, approval, or delivery.

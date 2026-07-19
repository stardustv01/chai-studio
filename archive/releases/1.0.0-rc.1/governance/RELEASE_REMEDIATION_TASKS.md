# Chai Studio Release Remediation Tasks

Date opened: 2026-07-18  
Candidate target: `1.0.0-rc.1`  
Scope: technical release readiness for the macOS-first personal Studio

This ledger is the authoritative work list for the gaps found during the final
owner and release-assurance reviews. A checked item requires reproducible
evidence from the current source tree; an earlier green report does not satisfy
the item after source or dependency changes.

## Automated implementation tasks

- [x] **R01 — Normalize release-candidate identity.** Use `1.0.0-rc.1`
      consistently across the root, workspaces, CLI, diagnostics, and generated
      technical evidence. Preserve `1.0.0` as the unapproved future stable target.
- [x] **R02 — Reproduce with the declared package manager.** Install from the
      frozen lockfile using pnpm `11.11.0`, then rerun the canonical validation
      commands without relying on pnpm `11.9.0` installation metadata.
- [x] **R03 — Refresh dependency and licence authority.** Regenerate the
      dependency/licence inventory from the exact install, resolve the Remotion
      compositor package classification from authoritative licence material, and
      keep unresolved or distribution-restricted packages blocked.
- [x] **R04 — Repair the minimum-window header layout.** At exactly
      `1180 x 720`, the contract-preview truth status must not overlap Edit,
      Inspect, Media, Animation, Deliver, or the render controls in any workspace.
      Add a cross-panel geometry regression test.
- [x] **R05 — Add an authenticated full A/V production journey.** Exercise a
      bounded real video render with authoritative audio, then verify decodable
      video frames, an audio stream, QA scope, output metadata, and receipt
      linkage. The existing PNG-only Still journey remains as a separate test.
- [x] **R06 — Refresh machine performance evidence.** Rerun the P26 benchmark
      and gate on the current Apple M4 / 16 GB machine after the source and
      dependency tree are frozen.
- [x] **R07 — Refresh security and recovery evidence.** Rerun local security,
      isolation, qualification, rollback, recovery, and disaster exercises from
      the final candidate tree.
- [x] **R08 — Refresh P27 release evidence.** Regenerate the release manifest,
      licence inventory, qualification reports, and gate evidence; require zero
      stale hashes or missing build artifacts.
- [x] **R09 — Refresh P28 technical evidence.** Regenerate the cross-system,
      preservation/recovery, traceability, walkthrough, and prepared receipt
      evidence from the final candidate tree. The receipt must remain
      unauthorized until the owner approves.
- [x] **R10 — Run the final technical regression.** Require lint, formatting,
      boundaries, typecheck, build, unit, property, integration, coverage, visual,
      golden, schema, isolated bundled-Chromium E2E, authenticated E2E, and all
      applicable phase contracts to pass from current source.
- [x] **R11 — Update release documentation truthfully.** Report technical
      readiness separately from owner approval, stable release, signing, and
      delivery. Do not describe P28 as complete while an owner-only item remains.

## Informed-permission task

- [ ] **R12 — Run the registry vulnerability audit.** This command sends the
      dependency inventory to the configured package registry. Run it only after
      the owner gives informed permission for that disclosure; record the exact
      command, registry, timestamp, and result.

## Owner-only release boundaries

These are deliberately not implementation tasks and cannot be inferred from
“fix all,” passing tests, or technical readiness:

- [ ] **O01 — Owner reviews the final technical evidence and explicitly
      approves Version 1.**
- [ ] **O02 — Generate and bind the immutable Version 1 manifest after O01.**
- [ ] **O03 — Sign the Version 1 release after O01 using the owner-approved
      signing process.**
- [ ] **O04 — Approve/tag/distribute the stable `1.0.0` build.**

Until O01 is explicitly granted, P28 final acceptance must continue to fail
closed. No agent may manufacture an approval record, signature, stable tag, or
delivery receipt to make the gate green.

## Completion record

Each completed task will be updated with the validating command and evidence
path. Any residual failure will remain unchecked with its blocker stated here.

- **R01:** All 17 distributable manifests now declare `1.0.0-rc.1`.
  `tests/unit/release-identity.test.ts` and the P27 contract enforce the shared
  identity. Focused result: 4/4 release-identity tests passed.
- **R02:** `CI=true corepack pnpm install --frozen-lockfile --offline` completed
  using pnpm `11.11.0`, reusing 410 cached packages with zero downloads.
  The P27 contract now executes `corepack pnpm --version` and requires exactly
  `11.11.0`; generated install metadata is not treated as executable-version
  authority. Lockfile SHA-256 remains
  `ac7b0aa0bbe73dcaba4175105a54c9cc771d3694b3af376e40e47a59ab042c1a`.
- **R03:** The refreshed deterministic inventory contains 410 installed
  packages and zero `UNKNOWN` licence rows, identity
  `cc4cd7f5020afb94449f705b220e1f96b8c121409d21e3cd8dce0086b2c69b38`.
  The Remotion compositor classification is tied to the exact v4.0.489
  repository licence while retaining an explicit packaging-time binary/codec
  review and a public-distribution block. The P23 release-review validator
  passed all seven checks.
- **R04:** The compact minimum-width header now keeps the capture action's full
  accessible name while shortening its visible label below 1280 px. A new
  geometry test checks every workspace navigation, truth, capture, timecode,
  and render control at exactly `1180 x 720`. Focused isolated bundled-Chromium
  result: 1/1 passed; installed Google Chrome was not selected.
- **R05:** The authenticated isolated-browser journey now imports an owned PCM
  WAV, overlaps it with real visual media through a revision-backed timeline
  command, and renders a bounded three-frame Review proxy. The test verifies a
  decodable `program.mp4`, the authoritative `program-audio-mix.wav`, one video
  stream, one audio stream, matching I/O scope, linked output/receipt/QA records,
  and a passed measured-audio QA result. A semantic rational-FPS comparison also
  replaced the prior JSON key-order comparison. Authenticated result: 1/1 passed
  in 18.6 seconds; approval remained null and delivery remained false.
- **R06:** A fresh local-only benchmark on the current Apple M4 / 16 GB arm64
  host produced 224 samples across eight budget classes with every budget
  passing and telemetry disabled. The complete P26 acceptance gate then passed
  all 18 stages, including real Remotion and HyperFrames runtimes, 58 isolated
  bundled-Chromium UI tests, production build, and security. Gate identity:
  `a342218fcbe2b49c6126ef2e3b2e4b283a58ca5c053919c7e4055c3d337e14cc`.
- **R07:** The local security scan reported no unsolicited telemetry or policy
  problems. All 21 focused recovery tests passed; the macOS adversarial
  isolation exercise passed its ten denial/resource-limit assertions; clean
  launch, repair, rollback/preservation qualification passed; and all nine
  disaster drills were regenerated. The complete P23 and P24 acceptance gates
  passed with identities
  `87cf71b374e927ffafa02e8c7297eaf51447e3e3dea449f19a3cd42403e00be3`
  and `8b1ffcd27112f2b2fd8699408581846b10895e4e8e95fa419eedd8f38e64cb92`.
- **R08:** The release-candidate manifest, local doctor, temporary-project
  qualification, Remotion and HyperFrames upgrade receipts, and nine disaster
  drills were regenerated from the current tree. The contract directly observed
  `corepack pnpm --version` as `11.11.0`, all regression stages passed, and the
  complete P27 gate identity is
  `45ce80e6f5172315ba2598824b60e2288da191a909dfaa2906798e3e5fd2b8c8`.
- **R09:** Cross-system fixtures, final preservation/recovery, walkthrough,
  traceability, and the prepared release receipt were regenerated from the
  current candidate. The receipt remains explicitly unauthorized. The complete
  preapproval P28 technical gate passed with identity
  `74db0a34e17928ab946954516cf447e34e061a9c17c2a5a3caf3971284ae8941`;
  no owner approval, signature, stable tag, or delivery was created.
- **R10:** The replacement P28 technical gate passed all 18 stages. Final
  evidence includes 323 passing unit tests, 20 property/fuzz tests, 87 ordinary
  integrations, real Remotion and HyperFrames runtimes, 58 isolated
  bundled-Chromium E2E tests, one authenticated A/V journey, 37 reviewed UI
  goldens / 40 governed artifacts, and coverage across 428 passing tests
  (65.95% statements, 51.81% branches, 64.00% functions, 68.37% lines). The
  P28 final contract was also checked and correctly failed closed because owner
  approval, immutable Version 1 binding, and signature evidence do not exist.
- **R11:** `README.md`, `governance/README.md`,
  `governance/P28_TECHNICAL_ACCEPTANCE.md`, and `USER_REVIEW_FEEDBACK.md` now
  distinguish the passed local technical candidate from the pending registry
  audit, explicit owner approval, stable release, signing, delivery, and public
  distribution boundaries. The invalid 2026-07-16 identity remains historical
  and is not reused.

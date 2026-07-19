# P24 acceptance — reliability, recovery, diagnostics, and repair

**Decision:** APPROVED for P25 implementation  
**Decision time:** 2026-07-16T14:50:30Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `0457366da87dbf3093c00a31ea10fbb15e85ae062c481002d7bbe6dc799b332c`

The corrected P24 gate passed all 17 formal checks in one authoritative run: frozen offline install, P24.01-P24.12 contract audit, 10 focused recovery fixtures, browser isolation, schema drift, repository-wide lint/format/boundaries, strict compilation, 280 unit tests, 17 property/fuzz tests, 72 integrations including both real native engines, one visual-manifest test, six golden checksum groups, 31 isolated-browser end-to-end tests, 28 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P24.01        | PASS   | Startup health verifies the Playwright-managed render browser without launching it, frozen engines/adapters, FFmpeg/codecs, macOS backend, registered fonts, project/temp permissions, disk, and project integrity. Every result is classified as blocking, degraded, or repairable.                                                                         |
| P24.02        | PASS   | The read-only scanner reports orphan/staging/invalid revisions, invalid current pointers, stale locks, missing or changed assets/fonts, external native-source edits, corrupt caches, incomplete renders, interrupted jobs, and recoverable autosaves without mutation.                                                                                      |
| P24.03        | PASS   | Explicit repairs cover verified pointer recovery, orphan adoption/rejection, stale-lock quarantine, exact-hash asset relink, external-source adoption through `source.edit`, cache/incomplete-output quarantine, interrupted-job cleanup with journal retention, and autosave restore. Every action writes evidence and records `sourceFilesDeleted: false`. |
| P24.04        | PASS   | Per-request recovery journals persist ordered stages across restart. Retry receives the prior request/output identity and only path/size/SHA-256-valid artifacts; corrupt or missing artifacts are excluded and stages cannot move backwards.                                                                                                                |
| P24.05        | PASS   | Cancellation/failure records retained partial output, completes operation barriers, never publishes incomplete output, and supports explicit queue cleanup while retaining the recovery journal. Cache cleanup remains bounded and protected entries remain intact.                                                                                          |
| P24.06        | PASS   | Bounded rotating local JSONL logs record correlation, stage/frame, timing, memory, concurrency, media/engine details, and cache reasons with centralized redaction and correlation search.                                                                                                                                                                   |
| P24.07        | PASS   | The Local diagnostics drawer presents a plain summary, startup health, recovery items, affected stage/entity/frame, suggested repair, safe-retry/source-inspection truth, detailed local evidence, and explicit refresh tools.                                                                                                                               |
| P24.08-P24.09 | PASS   | Support bundles require explicit record selection and a redaction preview, exclude media/executable source/secrets, and have no transmission path. Crash records remain local with `telemetryUploaded: false`; future telemetry remains disabled.                                                                                                            |
| P24.10        | PASS   | Fault injection covers revision write, cache publish, render stage, encode finalize, receipt write, and approval transition. Atomic boundaries resolve to the prior valid state or a complete hash-valid new artifact.                                                                                                                                       |
| P24.11        | PASS   | Existing and new suites cover low disk, corrupt media/cache, missing fonts/assets, browser/worker restart, cancellation/retry, cache deletion, concurrent commands, external source edits, stale locks, autosave, pointer corruption, and orphan revisions.                                                                                                  |
| P24.12        | PASS   | Backup, restore, project move, cache rebuild, repair, and recovery procedures are documented and fixture-tested; backup/move/cache removal preserve the authoritative revision hash.                                                                                                                                                                         |

## Authoritative recovery path

The accepted path is startup health -> read-only issue discovery -> explicit issue/action selection -> precondition and exact-hash revalidation -> atomic commit or quarantine -> immutable repair receipt -> rescan. Render recovery is immutable request -> ordered journal -> retained partial/cache artifacts -> hash validation after restart -> retry context -> completed output/receipt/lifecycle publication. No scan mutates and no repair silently deletes project source.

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p24/gate-report.json`                     | `cd3e4cce48959204c95f60245c63ad555a3d2af44ca3c06d04dccb299b6f8179` |
| `packages/render/src/recovery.ts`                   | `bf1a6438cc49ee373c18658fb7348a172884dabbbeeb81e492ea9cf206fba92d` |
| `apps/studio-server/src/reliability-service.ts`     | `657ddfde32e953177cace0c519dcf97c45c062d8ad76eadd91f63bdbc36d66e3` |
| `apps/studio-server/src/local-diagnostics-store.ts` | `df7bb3aa35c58b1dd62953f8ea7d261f3e6e7a78a0f2ea14555ba6efa25bf534` |
| `apps/studio-server/src/render-service.ts`          | `bfbf2ef965b5e8f5bedc8535c1a125ec99e6a34200ad5c25d51dce2a0263d532` |
| `apps/studio-web/src/App.tsx`                       | `7546a69f10176d42f2fba197226435e9c4bcac99e85ba6cf332fafc7cdca818b` |
| `docs/RECOVERY.md`                                  | `34c603fb76337f4156a515bc2a883dbcf7473059eb4d2500a538f46147ff1ee6` |
| `scripts/validate-p24-reliability-contract.mjs`     | `0300b111382a6772d54976c96140d689f412944251e31cc0f6222825e8218aac` |
| `scripts/run-p24-gate.mjs`                          | `1e52aaf5146af8304e8d6784dc62b19648aa61679aea6abe1e6afd304cd2d586` |
| `pnpm-lock.yaml`                                    | `6d54108aa85745ba1419e28ba5425fae5b62c17767239817f2a5d33a1b3bc689` |

## Controlled boundaries

- Recovery is local and explicit. Read-only scans, diagnostics, crash records, and bundle previews never transmit data; support export contains only selected redacted metadata.
- Pointer recovery refuses a valid pointer and accepts only a fully parsed, hash-verified immutable revision candidate. Orphan adoption additionally requires a direct child of the current revision.
- Asset relink accepts only the existing registered content hash. Changed bytes require normal explicit replacement and dependency invalidation.
- Failed/cancelled output and corrupt cache can be retained or quarantined, but never promoted as complete. Approved output/source protections remain stronger than cleanup convenience.
- UI tests remain bound to `playwright-managed:chromium-1228`; real-engine gates remain bound to `playwright-managed:chromium_headless_shell-1228`. Installed Google Chrome and persistent user profiles remain prohibited.

P25 may now add the Professional Expansion—advanced trim/source workflows, nested clips/takes, exact retiming, adjustment/effect ranges, advanced bridges/curves, and sample-aligned audio automation—without weakening P04-P24 authority, recovery, security, or reproducibility.

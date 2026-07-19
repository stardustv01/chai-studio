# P28 replacement technical acceptance — local candidate passed; release blocked

**Decision:** LOCAL TECHNICAL ACCEPTANCE PASSED; P28/V1 RELEASE NOT AUTHORIZED  
**Decision time:** 2026-07-18  
**Candidate:** `1.0.0-rc.1`  
**Replacement technical gate identity:** `74db0a34e17928ab946954516cf447e34e061a9c17c2a5a3caf3971284ae8941`  
**Owner approval:** PENDING; not inferred  
**Registry vulnerability audit:** PENDING informed permission

P28.01-P28.18 now have current local technical evidence. P28.19 remains
`pending-explicit-owner-approval`, and P28.20 cannot close until the owner has
reviewed the final evidence and explicitly authorized the immutable manifest,
signature, and release. No stable tag, signature, approval, delivery, or public
distribution authority exists.

The network registry vulnerability audit is deliberately separate from the
local gate because it sends dependency names and versions to the configured
registry. It remains pending until the owner authorizes that disclosure. The
Remotion compositor classification also retains its public-distribution
binary/codec review block. These boundaries do not invalidate personal-local
technical evidence, but they block a public or commercial release claim.

## Replacement evidence — 2026-07-18

- The authenticated launcher injects a per-session token before React starts,
  without placing the token in the URL or logs.
- Exact capture and local output execution use immutable shared, Remotion, and
  HyperFrames composition authority rather than DOM rasterization or a
  synthetic slate.
- The authenticated production journey imports owned visual and PCM WAV media,
  overlaps them through a revision-backed edit, renders a bounded three-frame
  Review proxy, and proves one video and one audio stream with FFprobe.
- QA evaluates the actual output scope, measured audio, and semantic rational
  FPS. The rendered A/V output reached `qa_passed` while approval remained null
  and delivery remained false.
- Media filtering, Animation containment, minimum badge/action sizes,
  minimum-window header geometry, Inspector action truth, Deliver selection,
  event recovery, three-point editing, and contextual menu geometry have direct
  regressions.
- Security, macOS adversarial isolation, recovery, backup/restore, qualification,
  disaster drills, performance budgets, visual fidelity, and release-identity
  evidence were regenerated from the current candidate.

## Current validation

- P23 security/isolation gate: passed.
- P24 reliability/recovery gate: passed.
- P26 M4/16 GB performance gate: 224 local-only samples and eight passing budget
  classes; complete gate passed.
- P27 release-candidate gate: passed under the directly observed
  `corepack pnpm 11.11.0` executable.
- P28 replacement technical gate: all 18 stages passed.
- Unit: 323 tests passed.
- Property/fuzz: 20 tests passed.
- Integration: 87 tests passed, including two managed native-composition tests;
  real Remotion and HyperFrames runtime tests also passed.
- Coverage: 132 files / 428 tests passed; 65.95% statements, 51.81% branches,
  64.00% functions, and 68.37% lines.
- Isolated bundled-Chromium UI/visual E2E: 58 tests passed.
- Authenticated temporary-project A/V journey: 1 test passed.
- Golden authority: 37 reviewed UI screenshots and 40 total governed artifacts
  passed checksum verification; all strict/perceptual P22 fixtures passed.
- Browser isolation reported `systemGoogleChromeSelected: false` and
  `persistentUserProfileConfigured: false`. Installed Google Chrome was not
  selected.

The production build continues to emit a non-blocking main-chunk size advisory.
It is a performance-hardening opportunity, not a correctness-gate failure.

## Historical invalidation retained

The 2026-07-16 identity
`ab0c00dee6b31c411a6fa8299d8e506dd454da0053368466cbc0c806ffb79fc4`
remains invalid. Authenticated owner evidence proved that candidate used
synthetic/interactive pixels and expectation-derived QA, while four required
visual goldens failed. Nothing in this replacement record retroactively
approves or reinterprets that historical evidence.

## Evidence identities

| Artifact                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p28-tech/gate-report.json`          | `236f72366a9d7cc5dfcecc34490454e831cc503b77649f2c41796493f508e575` |
| `evidence/p28/traceability-matrix.json`       | `6afedfeee8aab43f0f6f1a7ededd00b0b973d96bd5b1b983813c59f1eac6f97c` |
| `evidence/p28/walkthrough-report.json`        | `93933cc51bb3c14ed2dc5adbfb9865cdd1c1153a521a20df890f6c6e3faf57d3` |
| `evidence/p28/version-1-release-receipt.json` | `b483f9b519ed5f86bb46653167c0c1cc0e7a6d214f26684ea4efcc869c1edb1c` |

## Release boundary

The prepared receipt remains unauthorized with `releaseAuthorized: false`,
`signature: null`, and `pending-explicit-owner-approval`. A green technical gate
does not authorize P28.19/P28.20, public distribution, signing, delivery, or the
stable `1.0.0` release. Those decisions require the remaining informed audit and
explicit owner action.

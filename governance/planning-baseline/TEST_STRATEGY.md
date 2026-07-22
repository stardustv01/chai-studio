# Chai Studio — Test Strategy Draft

**Status:** Draft for P00/P03 review

## Principles

- Test authoritative contracts below UI surfaces.
- Preserve deterministic, rights-cleared, versioned fixtures.
- Require evidence for failures and accepted exceptions.
- Never relax correctness merely to make cross-platform snapshots pass.

## Test levels

| Level | Required focus |
|---|---|
| Unit/property | Rational math, ranges, mappings, commands/inverses, schemas, migrations, cache keys, audio automation. |
| Integration | Adapter seek/render, mixed preview, media/proxy, audio, captions, bridge boundaries, cancellation/retry. |
| Visual regression | Deterministic golden frames, alpha, captions, shaders, transforms, UI state gallery. |
| End to end | Create -> import -> mixed edit -> capture/context -> change -> reopen -> render -> QA -> approve -> reproduce. |
| Security | Path/symlink escape, origin/CSRF, network/environment denial, untrusted resource abuse, cache separation, redaction. |
| Reliability | Crash injection, stale locks, low disk, corrupt media/cache, worker restart, resume, repair, backup/restore. |
| Performance | Startup, open, seek, frame-step, timeline latency, capture, proxies, render, memory/GPU/disk, cache effectiveness. |
| Accessibility | Keyboard completion, focus, names/summaries, contrast, reduced motion, scalable text. |

## Required fixture families

- Remotion-only, HyperFrames-only, shared-only, and mixed-engine scenes.
- Rational FPS: 24, 25, 30, `24000/1001`, `30000/1001`, `60000/1001`.
- Nested rational rates, rational speed ratios, VFR proxy mapping, and long audio sync.
- Alpha, captions, fonts, bridges, shaders, missing/corrupt assets, and strict cache invalidation.
- Imported-untrusted abuse attempts.
- Core and Professional edit operations with undo/reopen.

## Visual parity

Same strict environment uses normalized pixel hashes for deterministic fixtures. Cross-environment comparisons use measured, fixture-specific perceptual thresholds approved from Milestone 0 evidence; there is no universal invented tolerance.

## Acceptance evidence per task

1. Implementation artifact or diff.
2. Automated result with environment identity.
3. Manual/visual evidence where required.
4. Requirement, ADR, risk, and release-gate traceability.
5. Exception, residual risk, and owner if not fully closed.

## Release blocking failures

Nondeterministic repeated seek, unacceptable engine/audio drift, capture/final mismatch, bridge boundary errors, state loss after undo/reopen, stale cache reuse, silent proxy/missing-source delivery, incomplete receipt, unsafe cancellation/recovery, unverified imported-code isolation, or QA bypass.

# Milestone 0 acceptance — P02.01–P02.25

**Decision:** APPROVED for production implementation  
**Decision time:** 2026-07-15T09:04:01Z  
**Supported baseline:** personal-use macOS, Apple Silicon, strict pinned environment  
**Planning baseline identity:** `b46733c9afa777c353d3114895f1503e6abedde3849593b73755e2e09aa353d1`

The refreshed Milestone 0 gate passed all 16 checks. The core suite passed 29/29 tests, the contract index passed every freeze assertion, and the full 379-task graph has no missing dependency, duplicate ID, ambiguous declared order, or cycle. Production implementation may proceed from P03.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                               |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P02.01 | PASS   | `spikes/milestone-0/package.json`, `pnpm-lock.yaml`, `.node-version`, and `evidence/environment.json` pin and identify the reproducible environment.                                                              |
| P02.02 | PASS   | `fixtures/canonical/fixture.json` plus generated media covers Remotion, HyperFrames, raw video, image, captions, voice, music, alpha, and 30000/1001 timing; `evidence/canonical-fixture-validation.json` passes. |
| P02.03 | PASS   | `src/rational.mjs` implements normalized rational rates, integer master frames, half-open ranges, and explicit audio rounding; rational and ten-minute tests pass.                                                |
| P02.04 | PASS   | `src/master-scheduler.mjs`, 29-test suite, and `evidence/interactive-preview-result.json` prove scheduler-owned play, pause, seek, step, loop, drift reporting, and hard resync.                                  |
| P02.05 | PASS   | `evidence/hyperframes-snapshot-result.json`, `remotion-still-result.json`, and `native-still-benchmark.json` prove deterministic exact still identity for both engines.                                           |
| P02.06 | PASS   | 120 native proxy frames, shared media, centralized audio, one master clock, and visible approximation/fidelity truth states pass browser QA in `evidence/interactive-preview-result.json`.                        |
| P02.07 | PASS   | `evidence/alpha-format-decision.json` measures qtrle/ARGB and RGBA PNG. The supported default is an 8-bit RGBA PNG sequence; qtrle remains conditional on a consumer-proven decoder.                              |
| P02.08 | PASS   | Remotion operates behind the replaceable finishing boundary and produced `evidence/mixed-finish.mov`; `mixed-finish-result.json` verifies 300 frames, 30000/1001, shared layers, and sample-exact PCM audio.      |
| P02.09 | PASS   | `src/audio-transport.mjs`, audio tests, `web-audio-result.json`, and the mixed finish prove one scheduler-following graph, exact 48 kHz mapping, and zero ten-minute integer-mapping drift.                       |
| P02.10 | PASS   | `src/revision-store.mjs` and revision tests cover immutable commits, optimistic concurrency, locks, both pointer-swap crash boundaries, ancestry, and orphan recovery.                                            |
| P02.11 | PASS   | `src/source-edit-session.mjs` and tests prove begin/commit/abort authorization and quarantine of unwrapped external changes.                                                                                      |
| P02.12 | PASS   | `src/security-policy.mjs`, the adversarial fixtures, and `evidence/isolation-report.json` verify denied filesystem, network, environment, process, worker, CPU, memory, wall-time, and output behavior.           |
| P02.13 | PASS   | `src/environment.mjs` and `evidence/environment.json` separate strict final identity from compatible preview identity and freeze cache-reuse rules.                                                               |
| P02.14 | PASS   | `evidence/benchmark-report.json`, `native-still-benchmark.json`, and `resource-benchmark.json` establish the first M4/16 GB seek, frame-step, capture, memory, GPU, drift, and throughput budgets.                |
| P02.15 | PASS   | ADRs 0001–0008 record accepted decisions, evidence, rejected options, limitations, and downstream verification points.                                                                                            |
| P02.16 | PASS   | `contracts/01-audio-transport.md` freezes scheduler/audio ownership, barriers, scrub/rate behavior, drift, latency, and native-audio suppression.                                                                 |
| P02.17 | PASS   | `contracts/02-command-authorization.md` freezes actor/session context, read/mutation/destructive levels, replay rules, and audit requirements.                                                                    |
| P02.18 | PASS   | `contracts/03-qa-delivery-lifecycle.md` freezes lifecycle transitions and prevents rendering from implying approval or delivery.                                                                                  |
| P02.19 | PASS   | `contracts/04-caption-render.md` freezes deterministic caption layer plans, fonts/glyphs, output artifacts, and QA anchors.                                                                                       |
| P02.20 | PASS   | `contracts/05-executable-isolation.md` freezes trust classes, roots, network/environment policy, resource limits, cache separation, and violations.                                                               |
| P02.21 | PASS   | `contracts/06-privacy-diagnostics.md` freezes redaction, retention, preview-before-export, relative paths, and zero unsolicited telemetry.                                                                        |
| P02.22 | PASS   | `contracts/07-preflight.md` freezes the common rule/result model consumed by planning, Deliver, and QA.                                                                                                           |
| P02.23 | PASS   | `contracts/08-source-monitor-boundary.md` freezes Foundation inspection versus Professional editing and prevents source transport from owning master time.                                                        |
| P02.24 | PASS   | `contracts/09-render-receipt.md` freezes complete reproduction, dependency, environment, output, audio, QA, exception, and approval evidence.                                                                     |
| P02.25 | PASS   | `contract-index.json`, `contract-freeze-validation.json`, and `task-graph-validation.json` report versioned ownership, complete dependencies, and zero cycles.                                                    |

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `spikes/milestone-0/evidence/gate-report.json`      | `7a5b0b7c70837dff08e0663d75c99f32d92a5d3582cd23b8788f92a6a35ba1de` |
| `governance/contract-freeze-validation.json`        | `4f60d18a060899bf9280b8aa040181f85a9e6e692eefa94ad4cc6db080e258d6` |
| `governance/task-graph-validation.json`             | `1d9e4828674da30d408c78732ab763895a7e859b439f4b7de0db9fdeb4d6c5a0` |
| `spikes/milestone-0/evidence/benchmark-report.json` | `3f94de586292a93768d647bfc23d40cdf101b8cfe3e302c030650a8b204fe771` |
| `spikes/milestone-0/evidence/mixed-finish.mov`      | `4aae8d8117be447da088407e223a338b847213fb8cfb03b5742f855d28ced816` |

## Accepted limitations and downstream gates

- The HyperFrames CLI snapshot near the final fixture frame showed an isolated capture-path anomaly, while adjacent frames and render self-verification—including frame 57—were correct. P11 must repeat native process-adapter capture acceptance before release.
- Remotion `OffthreadVideo` cannot decode the tested qtrle/ARGB bridge. P20 retains RGBA PNG sequences unless another bridge proves decoder, alpha, parity, boundary, speed, and disk criteria.
- AAC introduces encoder delay/padding and is never sample authority. P21/P22 must declare and validate delay/padding for compressed delivery profiles.
- `sandbox-exec` is macOS-specific and deprecated. P23 must harden or replace the isolation mechanism and rerun the adversarial matrix; imported executable content remains disabled when current policy evidence is unavailable or stale.
- P02 performance claims apply only to the measured Apple M4/16 GB fixture class. P09 repeats live process-adapter timing and P26 expands hardware/project classes.

These limitations are controlled downstream obligations, not unresolved P02 blockers. Any change to the accepted contracts or decisions requires a replacement ADR, impact analysis, migration plan, affected tests, and explicit approval.

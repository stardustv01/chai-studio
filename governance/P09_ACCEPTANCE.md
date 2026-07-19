# P09 acceptance — Preview core, master scheduler, and layer compositor

**Decision:** APPROVED for P10 implementation  
**Decision time:** 2026-07-15T15:55:24Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `e40211015e3cd47c63863c0148e40241e732f5269c44949fe68e714413d34706`

The P09 gate passed all 13 formal checks in one run: frozen offline install, preview-contract audit, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and visual-manifest regression tests, fixture golden verification, real-browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 161 unit tests, eight property/fuzz tests, 47 integration tests, one fixture visual test, six Chrome end-to-end tests, and 13 macOS UI golden screenshots.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                 |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P09.01 | PASS   | A pure observable transport machine defines stopped, loading, paused, playing, seeking, buffering, error, and disposed states; illegal events throw a typed transition error.                                                                                                                       |
| P09.02 | PASS   | `PreviewMasterClock` owns integer master frame, normalized rational FPS/presentation timestamp/play rate, half-open loop and in/out ranges, and bounded frame/second stepping.                                                                                                                      |
| P09.03 | PASS   | Seek barriers cancel the prior session, halt every attached adapter and program audio, request one exact rational-time frame, await readiness, present one composite, and report layer/audio partial failures without committing a stale frame.                                                     |
| P09.04 | PASS   | Synchronized sessions suppress native audio, accept adapter frame reports, calculate exact drift against the scheduler frame, count dropped frames, reject stale session reports, and trigger an atomic hard resync above the frozen half-frame policy.                                             |
| P09.05 | PASS   | Bounded preload windows aggregate half-open buffered ranges, media/engine/render-fallback/audio wait reasons, cache freshness, failures, in-flight work, and explicit back-pressure.                                                                                                                |
| P09.06 | PASS   | Draft/balanced/full interactive policies declare proxy/original choice, resolution scale, expensive-effect behavior, fallback permission, and load degradation; interactive output can never set `fidelityEquivalent`.                                                                              |
| P09.07 | PASS   | The layer graph validates deterministic z/source order, timeline activation, transforms, opacity, crop, blend modes, fit/fill, letterbox/pillarbox, shared/native/fallback layers, guides, and annotations before compositing.                                                                      |
| P09.08 | PASS   | Every layer has explicit unload/preload/ready/present/suspend/error/dispose boundaries. A failing layer produces a visible actionable warning while successful layers and transport remain valid.                                                                                                   |
| P09.09 | PASS   | Exact frame and short-range requests cross a replaceable final-compositor interface and require frame/range, compositor version, settings, strict environment, dependency graph, color, alpha, artifact, and normalized-pixel identity.                                                             |
| P09.10 | PASS   | Proxy, baked fallback, unsupported effect, missing asset/font, stale cache, buffering, dropped-frame, layer-failure, audio-rate, and render-required warnings carry direct remedy actions through server preview events into the live web truth projection.                                         |
| P09.11 | PASS   | The strict RGBA8 Rec.709 contract normalizes premultiplied to straight alpha, rejects undeclared color conversion, performs exact byte comparison, and derives deterministic normalized-pixel identities.                                                                                           |
| P09.12 | PASS   | The shared audio follower participates in halt/seek/play barriers, reports expected/observed samples and base/output latency, applies the half-frame-equivalent sample threshold, remains silent during seek/scrub/frame-step, mutes non-unit/reverse playback, and always suppresses engine audio. |
| P09.13 | PASS   | The mixed-engine fixture repeats seek/play/pause/frame-step/loop operations, injects drift and layer failure, changes quality/fallback state, prepares audio, and requests exact fidelity without losing scheduler authority.                                                                       |
| P09.14 | PASS   | `runPreviewAdapterConformance` publishes reusable preload, exact-presentation, repeated-seek, scheduler-playback, halt/suspend, and disposal checks for independent adapter upgrades.                                                                                                               |

## Authoritative evidence identities

| Artifact                                         | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `evidence/p09/gate-report.json`                  | `1f2fecb26d6daac574de87fb207fd29d2974214419114f1e5cf6a5ee25ecf51e` |
| `packages/preview/src/transport-machine.ts`      | `ce70ed5f05a4b22521427af5ac5631d4e2dcb0ed325c8791d3834c52880f05ce` |
| `packages/preview/src/master-clock.ts`           | `f5432023257020506e7f51f417a597ba74ddb10f38d2d248a3c60591cbb80ffe` |
| `packages/preview/src/scheduler.ts`              | `36c12acfc64fa9772a828b81a505fd3d655cd5fef6d40cab250d9a5ad7bbab24` |
| `packages/preview/src/layer-compositor.ts`       | `bc2bd59e25a913a1b36d21dbd4f92821791bdfb695e99f460c0eaafbd6a592db` |
| `packages/preview/src/preview-contract.ts`       | `f1768a5aa62ec2f1356190512bcfdb0521cba3a1d3f1545fda8fca1cef7030b2` |
| `packages/preview/src/audio-policy.ts`           | `83cc20a09a5fd5abee7fa081203f7f52f13b51f2e67fe9533e01e95dccf59fe4` |
| `packages/preview/src/color-normalization.ts`    | `b3cc1a97c2156ac5172dcadcabee380e4b57b823807f5bb08bc1db4f23a5f849` |
| `packages/preview/src/conformance.ts`            | `8f3d4d7a96ee3257f47b7d431f82d78192b5aacfc51fe03872e22bc8582b7c34` |
| `apps/studio-server/src/preview-service.ts`      | `aa424d6781b959173a14659d9dab511f1d6c993681d9d02b1412b6eb7be51676` |
| `tests/integration/preview-mixed-engine.test.ts` | `f3ea9ba620882976d153050af205d04bb30faf31f8e05b3eed9c06fa522144e6` |
| `scripts/validate-p09-preview-contract.mjs`      | `1f8226162c5e7656ab9eedd4698a37d2d3b25601cad45769b156b7e94115f1b0` |
| `pnpm-lock.yaml`                                 | `0ce5cc39ef22ee8d3e78290ecfff800e43c5a197485aa405520c6548b0d49091` |

The gate report hashes every accepted P09 implementation and test boundary. The stable identity includes platform, architecture, Node version, lockfile, implementation hashes, and pass/fail results without treating timestamps or durations as authority.

## Controlled boundaries

- The scheduler is the sole program-preview clock. Adapters and the shared audio graph are followers; native player playback is only a synchronized optimization and cannot commit authoritative time.
- Interactive approximation stays visibly distinct from final-compositor truth. Proxy, degraded, fallback, unsupported, stale, or missing dependencies cannot be relabeled as fidelity.
- P09 freezes the adapter interface and conformance harness; it does not claim that production Remotion or HyperFrames adapters exist. P10 and P11 must implement and pass this harness independently.
- P09 defines and tests the final-compositor request/identity boundary with a deterministic fixture. The production compositor, engine still/range renderers, cache, receipts, QA, and delivery remain owned by later phases.
- The shared audio follower contract is authoritative, but the full program audio graph, scrub grains, automation, loudness, and final mix remain P16 scope.
- Preview state, warnings, buffering, drift, and remedies reach the authenticated server event stream and live web projection. Contract-mock UI content remains visibly non-authoritative when no launcher session exists.
- FNV-1a normalized-pixel identity is a deterministic in-memory contract/test identity, not an artifact-integrity or security hash. Final artifacts and receipts continue to require SHA-256 through render-core.

P10 may now implement the pinned Remotion adapter for discovery, validation, native preview, exact still/range render, dependency collection, diagnostics, inspector descriptors, and finishing-compositor generation against the accepted P09 conformance contract.

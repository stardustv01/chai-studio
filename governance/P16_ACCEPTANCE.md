# P16 acceptance — Authoritative audio graph, preview mix, and final mix

**Decision:** APPROVED for P17 implementation  
**Decision time:** 2026-07-16T04:57:40Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `3bcd510665269e124cb1cf4341ebe7d4ba22f5807c78962ea6e07f59d6850e0d`

The P16 gate passed all 16 formal checks in one authoritative run: frozen offline install, the P16.01-P16.12 contract audit, browser-isolation enforcement, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, ordinary integration plus sequential real Remotion and HyperFrames runtimes, visual-manifest regression, fixture golden verification, browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 223 unit tests, 11 property/fuzz tests, 59 integration tests including both real native engines, one fixture visual test, 24 browser end-to-end tests, and 23 macOS UI goldens including the reviewed full-studio P16 Audio Mixer surface.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P16.01 | PASS   | The human-readable versioned AudioGraph schema covers sources, clips, buses, gain, pan, fades, automation, ducking, channel maps, sync anchors, and processing references as project authority.                    |
| P16.02 | PASS   | Exact rational master-frame to sample-range mapping uses floor start and ceiling exclusive end and survives long-duration and non-integer-rate property tests.                                                     |
| P16.03 | PASS   | Preview decode/cache chooses original or proxy explicitly, validates exact decoded ranges, resamples and maps channels deterministically, fills gaps with silence, and reports source/range failures.              |
| P16.04 | PASS   | The Web Audio graph follows the master scheduler at project sample rate, shares automation/fade evaluation, bounds scrub grains, compensates latency, reports dropped buffers, and suppresses native-engine audio. |
| P16.05 | PASS   | Gain, mute/solo, pan, fades, equal-power crossfades, keyframed volume, explicit channel matrices, and bus routing use shared deterministic evaluators.                                                             |
| P16.06 | PASS   | Voiceover, music, SFX, ambience, and master buses evaluate deterministically and expose live/muted state plus meters through the accepted mixer surface.                                                           |
| P16.07 | PASS   | Ducking is generated as attributable reversible automation and committed through typed audio commands rather than hidden signal processing.                                                                        |
| P16.08 | PASS   | Normalization and noise-reduction plans create separately attributable generated assets while preserving original media and explicit processing identity.                                                          |
| P16.09 | PASS   | The offline renderer consumes the authoritative graph into lossless PCM, supports progress/cancel/retry and partial cleanup, and binds the FFmpeg handoff to that exact PCM artifact.                              |
| P16.10 | PASS   | Loudness, true peak, clipping, silence, channels, sample rate, and duration are measured into immutable render receipts and QA evidence; clipped output fails QA.                                                  |
| P16.11 | PASS   | Waveforms, meters, automation lines, fade handles, sync markers, descriptors, and the Audio Mixer dispatch typed commands to one shared preview/final graph.                                                       |
| P16.12 | PASS   | Boundary, long-timeline, transport, scrub, crossfade, ducking, channel, silence, clipping, persistence, cancellation, retry, real-engine, browser, and visual acceptance tests pass.                               |

## Authoritative audio path

The accepted path is audio UI intent -> strict typed `audio.edit` command -> semantic validation -> immutable project revision -> authoritative AudioGraph resync. Preview scheduling and offline rendering both evaluate that graph at exact rational frame/sample boundaries. Web Audio follows the scheduler and never becomes clock authority; native Remotion and HyperFrames audio remains suppressed. Final encoding consumes the authoritative PCM mix artifact rather than rebuilding a second simplified graph.

## Authoritative evidence identities

| Artifact                                    | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p16/gate-report.json`             | `3ff7ab485abc282d985c911b8a2e753b0707954ac11f0937f870e4faa4847de0` |
| `packages/audio/src/offline.ts`             | `c5880319ea64eb83b2badc6a90aace43ee28eb2fd58cef048920e113c2b43ebd` |
| `packages/audio/src/web-audio.ts`           | `ff6c5b2702447295cbea47ca01cf57defca32011004bbd71e175d9151ca4532a` |
| `packages/audio/src/graph.ts`               | `068fbb5f151f188b94915666df93f6929b0c465b0b6068731ae6b38e995e1ee2` |
| `packages/schema/src/project-documents.ts`  | `f6e799cf40d00296d0eb762beb7aa21cd55ecc64deac79ba53a9ac25be7373ba` |
| `apps/studio-web/src/audio-mixer-panel.tsx` | `614d9708933d1a402b07e59e3618abe82b8d001e94ae26828b284b529f4e3cd2` |
| `tests/e2e/audio-mixer.spec.ts`             | `bfb0ffbba4eb2388a31795739ff4f0cd171aed2ad57b5b5e727770b329a56f45` |
| `scripts/validate-p16-audio-contract.mjs`   | `cd13210fe7608fd6700aed738b8ad5ce1cb4e3b4569635ac03a23db92771cf05` |
| `pnpm-lock.yaml`                            | `302d573e8fa323b2fe4ed40605e73f7a7d453b687b9883ab34a7abdb2eacd3a6` |

The gate report hashes every accepted P16 implementation, schema, test, golden, and browser-safety boundary. Its stable identity binds the Playwright-managed Chromium executable and identity together with platform, architecture, Node version, lockfile, implementation hashes, and check outcomes.

## Controlled boundaries

- Audio mutations must continue through typed commands, semantic validation, immutable revision commit, and authoritative resync. UI, Web Audio nodes, meters, decoded buffers, and scrub grains are never project authority.
- Preview and final output must continue to consume one AudioGraph and shared evaluators. A second simplified FFmpeg mix graph is prohibited.
- Frame/sample mapping remains exact rational arithmetic with floor start and ceiling exclusive end. Automation, fades, sync evidence, affected ranges, and duration alignment cannot use floating-point time as authority.
- Web Audio follows the master scheduler. Ordinary seek and frame-step remain silent; scrub audition is an explicit bounded grain; native-engine audio remains suppressed.
- Original media is preserved. Normalization, denoising, proxies, channel conversion, and resampling remain explicit, attributable, and reproducible.
- Loudness or encoding success never implies QA, approval, delivery, or release. Audio measurements remain receipt and QA evidence, and clipped authoritative mixes fail QA.
- Installed Google Chrome remains prohibited for tests and previews. Browser work must resolve to the verified Playwright-managed Chromium identity, use temporary isolated profiles, and pass the browser-isolation and security checks before launch-capable gates run.

P17 may now implement transcript and caption authority, import/normalization, navigation and reversible edit commands, caption layout/style/artifacts, planning hooks, and complete accessibility/round-trip/render evidence without weakening the accepted audio, scheduler, command, revision, native-ownership, QA-lifecycle, or browser-isolation boundaries.

# P06 acceptance — media, assets, proxies, fonts, and rights

**Decision:** APPROVED for P07 implementation  
**Decision time:** 2026-07-15T12:40:36Z  
**Supported baseline:** personal-use macOS, local self-contained project folders  
**Gate identity:** `d1e02b71030502594c16e7c8674c243301ae326d25fbb0af6a0f0fc800995f1c`

The P06 gate passed all 11 formal checks: frozen offline install, media-fixture contract, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and visual regression tests, golden verification, and the production build. The accepted repository has 118 unit tests, eight property/fuzz tests, 32 integration tests, and one visual golden test. The local server health integration required the acceptance runner to bind a temporary loopback port; it passed under the supported macOS runtime.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                       |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P06.01 | PASS   | Stable asset IDs, canonical registry paths, streamed SHA-256 identity, immutable registration, rights classification, validation status, audit, and duplicate-path/ID rejection keep `assets.json` authoritative.                                         |
| P06.02 | PASS   | Realpath-based project containment, traversal/prefix rejection, regular-file checks, approved external-root aliases, and symlink-escape diagnostics constrain every resolved source.                                                                      |
| P06.03 | PASS   | ffprobe parsing and execution retain container, codec, dimensions, exact rational rates/time bases/durations, sample rate, channels, alpha, VFR status, and content-hash-keyed validated cache results.                                                   |
| P06.04 | PASS   | Hash grouping exposes duplicates without identity merging; path-plus-content observations distinguish unchanged, missing, moved, changed, and moved-plus-changed sources and require explicit action.                                                     |
| P06.05 | PASS   | Exact timestamp cadence detects VFR and every CFR proxy frame maps deterministically to the nearest original timestamp with a frozen earlier-frame tie rule.                                                                                              |
| P06.06 | PASS   | Fingerprinted proxy profiles, content-addressed keys, atomic generation, background job state/cancellation, original/proxy switching, invalidation, and a final-original guard prevent silent proxy delivery.                                             |
| P06.07 | PASS   | Thumbnail, contact-sheet, filmstrip, and waveform pipelines share verified atomic content-addressed caching, cancellation, corruption/deletion recovery, profile/source invalidation, and deterministic PCM envelopes.                                    |
| P06.08 | PASS   | Actual OpenType name-table parsing, bundled/approved-external policy, versioned hash-addressed manifests, identical-byte environment fingerprints, and missing/hash-drift diagnostics freeze project fonts.                                               |
| P06.09 | PASS   | A rebuildable asset index supports normalized text and compound type, duration, resolution, rights, status, date, and usage filtering with exact rational comparisons, bounded pagination, and deterministic stable sorting.                              |
| P06.10 | PASS   | Same-hash relink and identity-preserving replace produce inverse mutations and cache invalidations; usage reports, canonical Finder reveal plans, hashed curation manifests, and duplicate review queues expose approved/rejected/favorite/pending state. |
| P06.11 | PASS   | Versioned detailed-rights records cover source, creator, license, restrictions, attribution, hashed proof, expiry, review identity/date, territory, and prohibited use; selected delivery policy produces deterministic warnings or blockers.             |
| P06.12 | PASS   | The deterministic fixture contract covers corrupt, missing, VFR/alpha, font, proxy, relink, duplicate, rights, traversal, and cache-deletion cases and links every case to executable milestone tests.                                                    |

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p06/gate-report.json`                     | `6f26a6e7ece138b5efbbd8f39b5f8b188049a5b7646803bb24c1ef92a26d598b` |
| `packages/media/src/asset-registry.ts`              | `86b699de14448b7a353b81c7713d851dc28987eec71525185b3359e6f2ab1c36` |
| `packages/media/src/media-inspection.ts`            | `4ad7b293a1ce0d215dc8ca0a790d3c396ca01f5753bfb55a5cefe4baa852a634` |
| `packages/media/src/proxy-manager.ts`               | `77bc4887dc0c901234f18e05ab1b3050ead6f994c5f931750e625788f035b28d` |
| `packages/media/src/generated-views.ts`             | `cbd662569c5f06902486cdf286e467f52ea1b63ba086fbc92933a1d7abd2f2ee` |
| `packages/media/src/font-registry.ts`               | `41c78e1bdd1ea4d00cb74f67cf9192a5af760be7176c282fa8929f39e4ef53b3` |
| `packages/media/src/asset-index.ts`                 | `2d80b329fc20ec6080ab3843ca7d367eaae1b32e108485a88c2c4d2fe787acdb` |
| `packages/media/src/asset-workflows.ts`             | `f3a33c489db8353dd092baec9f27785f3e3bf159ecdba55a28f2b1f4ab0b2a39` |
| `packages/media/src/asset-rights.ts`                | `877338ed8700acc7fceb9805756b8732c4503fc5adda8a55f2364815a159f39a` |
| `fixtures/deterministic/media/p06-media-cases.json` | `19cbf498dbf1be3f692a871072a4197513526712314656a31f3a52132b09eaec` |
| `pnpm-lock.yaml`                                    | `1b7cae1b7c3ad71a37c7795f58d2256fe586deba126e06691241eea059e9fb03` |

## Controlled boundaries

- `assets.json` remains the P04 authoritative registry. Inspections, indexes, proxies, generated views, and usage reports are rebuildable; deleting them cannot alter project state.
- Font, curation, and rights manifests are versioned project dependencies represented by hashed `data` assets. P07 must commit their serialized files and matching asset hashes through the accepted revision/command authority; HTTP handlers may not mutate them directly.
- The media package creates an authorized macOS Finder reveal plan but never launches GUI processes itself. P07 owns the scoped endpoint and execution policy.
- P06 provides deterministic in-process job contracts and pure media workflows. P07 owns durable API jobs, worker isolation, progress events, cancellation transport, and restart supervision.
- Proxy selection is valid only for labeled interactive preview. Final render and delivery must resolve original source content hashes, regardless of UI preference.

P07 may now expose the accepted project, command, media, preview, bridge, render, and QA capabilities through a versioned loopback-only Studio server, structured event bus, and supervised workers without creating new state authority.

# P23 acceptance — security, privacy, executable isolation, and licensing controls

**Decision:** APPROVED for P24 implementation  
**Decision time:** 2026-07-16T13:02:40Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `cfa00f51da7c213fac07c8bf18f10b42d7d938e609e3a24006754f6a54c194a1`

The corrected P23 gate passed all 18 formal checks in one authoritative run: frozen offline install, P23.01-P23.14 contract audit, live macOS adversarial isolation, exact dependency/license inventory and release workflow, browser isolation, schema drift, lint/format/boundaries, strict compilation, 274 unit tests, 17 property/fuzz tests, 68 integrations including both real native engines, one visual-manifest test, 31 isolated-browser end-to-end tests, 28 macOS UI goldens, production build, and security inspection.

The counts and identities in that acceptance run remain historical. For the current RC4 working candidate, the deterministic inventory contains 410 installed packages with zero unknown licenses and identity `2e03803a3be61b67561fdd7081b763b760a72fffdeeedcffddeeefa9c42f8b00`. Its file SHA-256 is `cae20ecb4b62bde2a034db61022ec83a842194fabaca92effa118e4fc0fb1b76`. The tracked isolation report SHA-256 is `d865895b5ae7094ffaec3dc1898ce073d95ff7f73612c87c54f3873615851583`; a fresh read-only macOS probe must still pass in the protected release job. These refreshed technical identities do not approve public distribution.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P23.01        | PASS   | The threat model covers the local server, browser UI, files, imported media, executable compositions, bridge/CLI, workers, caches, logs, outputs, dependencies, release controls, mapped tests, and explicit residual risks.                                                                                                                                                                                                                                          |
| P23.02        | PASS   | The server binds only IPv4/IPv6 loopback, validates loopback Host and exact Origin, requires a 256-bit session token, and requires the matching anti-CSRF value for approved-origin browser mutations. CORS remains exact and no LAN mode exists.                                                                                                                                                                                                                     |
| P23.03        | PASS   | Security paths reject lexical traversal before canonical resolution, resolve symlinks through real paths, enforce read-only/read-write/temp/output root modes, and protect prospective output parents from symlink escape.                                                                                                                                                                                                                                            |
| P23.04        | PASS   | Executable trust records bind to exact composition source hashes. Imported content cannot be promoted by successful rendering; an explicit complete review is required. Trust and policy identity appear in the HyperFrames inspector, render preflight, API workspace, and immutable receipt.                                                                                                                                                                        |
| P23.05-P23.06 | PASS   | Network is denied by default; only exact non-local HTTPS URLs paired with SHA-256 are eligible, and mismatched bytes cannot enter cache. Worker environments expose only non-secret allowlisted keys with fixed `C.UTF-8`/`UTC` and an environment identity.                                                                                                                                                                                                          |
| P23.07        | PASS   | CSP, COOP/CORP, Permissions-Policy, referrer, MIME, and framing headers protect the Studio UI. Navigation/local service remain same-origin; popups, downloads, protocols, and permissions are denied; file URLs require canonical approved roots; clipboard requires an explicit gesture.                                                                                                                                                                             |
| P23.08-P23.09 | PASS   | Imported execution is fail-closed behind current evidence. The macOS matrix proved filesystem, process, worker, network, environment, wall-time, memory, and output containment. Worker pool, browser profile, temp root, cache namespace, environment, trust, and artifact provenance are policy-bound and non-interchangeable.                                                                                                                                      |
| P23.10        | PASS   | Browser-safe recursive redaction covers bearer/auth/cookie/credential/password/token/API-key values, email PII, home/temp paths, unrelated environment values, project-relative context, bridge logs, render warnings/commands/violations, and explicit support-bundle previews excluding source media/code.                                                                                                                                                          |
| P23.11        | PASS   | Destructive grants are single-use, expiring, exact operation/project/target scoped. Scope mismatch and replay fail. External publishing/uploading remains unsupported in the personal local baseline.                                                                                                                                                                                                                                                                 |
| P23.12-P23.13 | PASS   | The deterministic inventory records 395 installed packages, exact Remotion/HyperFrames versions and local license metadata, FFmpeg binary/configuration obligations, both managed Chromium artifacts, fonts/assets, and release triggers. Public, commercial, scale, engine, codec, font, or asset changes are blocked pending explicit review. One native Remotion compositor package lacks declared local license metadata, so public distribution remains blocked. |
| P23.14        | PASS   | Adversarial tests cover path/traversal/symlink escape, network/hash denial, environment stripping, browser capabilities, resource limits, provenance/cache contamination, redaction leakage, Host/Origin/token/CSRF, trust promotion, destructive authorization, and release controls.                                                                                                                                                                                |

## Authoritative security path

The accepted path is exact source identity -> authoritative trust record -> project policy identity -> canonical path/network/environment/browser containment -> trust-separated worker/profile/temp/cache -> immutable artifact provenance -> redacted preflight/receipt/diagnostics. Missing, stale, or deprecated imported-containment evidence disables imported execution rather than weakening policy.

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p23/gate-report.json`                     | `e99ceb6b94f182f1e8c8e64b38be3cae051ca68c0a0abbf250986598d55810be` |
| `spikes/milestone-0/evidence/isolation-report.json` | `bd93362b5facefd2ac4205aaed2f9e76815a0386e170c4b1a4683163db928496` |
| `governance/licenses/dependency-inventory.json`     | `e8101f4d7bb802d1e2ad7c4004e24052edd0c7565e771961c3cb0788bb940b5b` |
| `packages/security/src/contracts.ts`                | `77feb5badc1dcbf03cb52f16c4a97e220677532f85e1742bd60be7a3a4e55018` |
| `packages/security/src/policy.ts`                   | `bd6cfc9dfcc2b248499b90543aced8ac96b0f4c851b680740a1e6ed4be3d04b6` |
| `packages/security/src/path-policy.ts`              | `8cd46b6a84b4435f27853eca83fc8e7ea309f7494131effa98904a8b8d815dca` |
| `packages/security/src/network-policy.ts`           | `848c6c2cf81d07cfd5d3289ccd35dfeb90a81e2c50749cd62e09e449b9979070` |
| `packages/security/src/environment-policy.ts`       | `9d1966fd1d75363bdd47610da21a6f5b2712ee295fcdf2b0065dddd9e742f408` |
| `packages/security/src/browser-policy.ts`           | `132568dd3f2feecba13126becc122746c7535a454d9f69442d516ca837b58277` |
| `packages/security/src/worker-isolation.ts`         | `157009b7d93731106f23c87a93dcb84073cb46525a9e8df67bff249e58daea28` |
| `packages/security/src/authorization.ts`            | `fc9824ce1b5004076ef96bfc2accf3ce0dd81cc1f4c4d3d13a654b60487b62a4` |
| `apps/studio-server/src/request-security.ts`        | `06fa912116829f28752e82b0cc9f55adf72dabbecffd254d4932762b6bd6abfa` |
| `apps/studio-server/src/render-service.ts`          | `c3d3b9be71f6ca1cfafcc937602ac69cee14a4aef07fdd6afbb16676366f1a7c` |
| `packages/diagnostics/src/index.ts`                 | `fd3220f3cc0121b0ea9e60f95c28f1e6a6c38329e8beb82b211e0cccb8b07bac` |
| `scripts/validate-p23-security-contract.mjs`        | `e2b93d0ec8cf061a415775f286e9f6d260323fa7f15d736057d016f4929b5d0b` |
| `scripts/run-p23-gate.mjs`                          | `b9e144b53521f8b8e7e771b36ec47171a3794bdd793914234660757014c8bd2f` |
| `pnpm-lock.yaml`                                    | `6d54108aa85745ba1419e28ba5425fae5b62c17767239817f2a5d33a1b3bc689` |

## Controlled boundaries

- Personal local use is the only accepted distribution scope. Public/commercial/team/scale changes require a fresh exact legal and packaging review; this engineering record is not legal advice.
- Imported execution requires explicit project opt-in and the exact current macOS isolation evidence identity. `sandbox-exec` deprecation remains a recorded residual risk; loss or staleness disables the feature.
- Trusted authored code is executable and is not treated as a general malware sandbox. Imported and trusted provenance/caches cannot cross policy identities.
- Studio UI tests remain bound to `playwright-managed:chromium-1228`; real-engine gates remain bound to `playwright-managed:chromium_headless_shell-1228`. Installed Google Chrome and persistent user profiles remain prohibited.

P24 may now add startup health, explicit repair scanning/actions, resumable validated render reuse, safe cleanup, local diagnostics/metrics/bundles/crash records, fault injection, recovery tests, and validated recovery procedures without weakening P23 containment, privacy, or release blocks.

# P27 acceptance — release engineering and local distribution

**Decision:** APPROVED for P28 final acceptance  
**Decision time:** 2026-07-16T16:32:23Z  
**Release candidate:** `1.0.0-rc.1`  
**Supported baseline:** personal-use macOS, Apple M4, 16 GB unified memory, arm64, local-only runtime  
**Gate identity:** `fb916983f618313ad9f4bce60df2b78e13c673f14f5a68a024c7b2248af2d166`

The P27 gate passed all 18 formal checks in one authoritative run: frozen offline install, P27.01-P27.17 contract audit, deterministic 769-file release manifest, doctor and loopback qualification, both engine-upgrade rehearsals, 31 focused release/disaster fixtures, browser isolation, schema drift, repository lint/format/boundaries, strict compilation, 308 unit tests, 20 property/fuzz tests, 78 integrations including both real engines, visual-manifest and checksum validation, 41 isolated-browser E2E tests, 35 reviewed macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                             |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P27.01-P27.04 | PASS   | Machine-readable support/launch matrix, exact doctor fingerprint, marked local install, loopback launch, RC release identity, and UI About diagnostics agree on pins and supported environment. |
| P27.05-P27.06 | PASS   | Current user and developer guides trace major workflows, one edit, one render, architecture, debugging, fixtures, and release evidence.                                                         |
| P27.07-P27.09 | PASS   | One-engine-at-a-time upgrade automation, compatibility/migration backups, rollback rules, capability/security/license/performance checks, and written receipts are executable.                  |
| P27.10-P27.12 | PASS   | Nine example descriptors, a blocking RC checklist, and the Version 1 no-wrapper ADR preserve the local product boundary.                                                                        |
| P27.13-P27.15 | PASS   | Install/doctor/health/uninstall qualification passes; backup, validation, restore, clone, archive, cache exclusion, delivered-artifact preservation, and project preservation are verified.     |
| P27.16-P27.17 | PASS   | Nine disaster drills and post-release triage/security/backup/rollback/regression procedures use the same evidence and change gates as production.                                               |

## Authoritative release path

The accepted path is immutable source bundle -> frozen dependency lock -> strict build -> generated schema/license/security checks -> production byte hashes -> release manifest -> supported-environment doctor -> marked installation -> loopback launch -> qualification/disaster evidence -> preservation-safe uninstall. No cloud account, automatic browser opening, installed Google Chrome selection, or desktop wrapper is introduced.

## Authoritative evidence identities

| Artifact                                          | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p27/gate-report.json`                   | `c92404a2af0e47dbe1d782991c36d61c821c9a159853de2c4f139aef7af42bfa` |
| `evidence/p27/release-manifest.json`              | `a9ccda21d3fa14d304f7bf5c74647d767bdd6f578a128c16e08b9eaa3772a28f` |
| `evidence/p27/qualification-report.json`          | `7a16b0d1165bfd7d50a0f79cb5e4a99b3652d3702ea1be51e75e44820a44a409` |
| `evidence/p27/disaster-drill-report.json`         | `aceb993f2decfc85dfa040f35ba1bc0e942c912a91d10e7a50ea82905f995c12` |
| `scripts/chai-studio.mjs`                         | `c3dc7ba297b20087b22e3e536da85e9d79902690f9b10a307792d28cc038b79c` |
| `scripts/release-operations.mjs`                  | `1b771fbf5d0e3af93508680bd9d3310448fae46b6c29a2c603866ec471c35541` |
| `packages/diagnostics/src/release.ts`             | `48374b2d3ef0d18521af6bef4416eaa537064bc32edf0f97791dc9c135177d00` |
| `docs/INSTALLATION.md`                            | `39afe7c389301f1501acad0af74dd89ff4ab7b89aecb90921ae7d835afdcfa0d` |
| `governance/adrs/0010-localhost-v1-no-wrapper.md` | `6f185affd7c62cc6a49bcd5f8702efaa6efea56cd901f56758bc1bf3ee3202de` |
| `pnpm-lock.yaml`                                  | `a66f716908a777c3e305d2d4fa7c0c455586fc1990ad94656e6148606077f25c` |

## Controlled boundaries

- P27 accepts a release candidate and its local distribution mechanics; it does not itself grant final Version 1 owner approval.
- Uninstall accepts only a valid application marker, refuses nested `.chai` projects, and never deletes projects or approved outputs outside the prefix.
- Release checksums are authoritative for personal local distribution. Platform signing/notarization is not applicable until a wrapper or public distribution is separately approved.
- UI and real-engine tests remain bound to Playwright-managed isolated Chromium identities; installed Google Chrome and persistent profiles remain prohibited.

P28 may now run final cross-system acceptance, close corrections, assemble complete traceability, and prepare the Version 1 receipt. Explicit owner approval remains a separate final release authority.

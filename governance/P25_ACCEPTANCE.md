# P25 acceptance — professional expansion

**Decision:** APPROVED for P26 implementation  
**Decision time:** 2026-07-16T15:34:20Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `57e8da8b3cffb14f25a33e18bcd9ab2200c081b8648375aa9f6320cb6620068c`

The corrected P25 gate passed all 17 formal checks in one authoritative run: frozen offline install, P25.01-P25.15 contract audit, 15 focused professional-edit fixtures, browser isolation, schema drift, repository-wide lint/format/boundaries, strict compilation, 292 unit tests, 19 property/fuzz tests, 73 integrations including both real native engines, one visual-manifest test, six golden checksum groups, 36 isolated-browser end-to-end tests, 31 reviewed macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task          | Result | Acceptance evidence                                                                                                                                                                                        |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P25.01-P25.03 | PASS   | Roll, slip, and slide are exact reversible commands with adjacent-handle validation, linked-edit policy, stable selection, and duration/range invariants.                                                  |
| P25.04        | PASS   | The Professional source monitor owns an independent source clock, source marks, target patching, and validated insert/overwrite/replace three-point commands.                                              |
| P25.05-P25.06 | PASS   | Compound creation captures child clips, automation, keyframes, bridges, transitions, and dependencies; flatten restores them. Take stacks retain inactive references and activate alternatives explicitly. |
| P25.07-P25.09 | PASS   | Freeze, reverse, normalized rational speed, and time remap share one deterministic preview/render evaluator with explicit audio and monotonicity policies.                                                 |
| P25.10,P25.14 | PASS   | Adjustment/range effects require explicit cross-engine bake/fallback policy and expose only the affected cache ranges.                                                                                     |
| P25.11        | PASS   | Advanced bridges persist ownership, handles, alpha, roll, audio envelope, fallback, exact range, and passed boundary QA without blank or duplicate coverage.                                               |
| P25.12        | PASS   | The curve editor supports multi-property selection, value/speed graphs, tangent modes, align/distribute, retime, copy/paste, zoom, and deterministic round-trip evaluation.                                |
| P25.13        | PASS   | Audio crossfades, ducking, sync anchors, bus automation, and bounded meter history remain reversible and sample-aligned.                                                                                   |
| P25.15        | PASS   | Unit, property/fuzz, reopen/parity, real-engine, UI interaction, and reviewed visual suites pass without weakening Foundation guarantees.                                                                  |

## Authoritative professional-edit path

The accepted path is source/timeline selection -> validated professional command -> exact frame/rational/sample transformation -> immutable revision -> shared preview/render/cache dependency evaluation -> undo/reopen parity. Unsupported cross-engine effects and bridges require explicit fallback or bake policy; experimental bridges require passed boundary QA before persistence.

## Authoritative evidence identities

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p25/gate-report.json`                     | `6f82649854b9bf2720485168d80db7e6372f1ec9eafdcc6aedfb5b139b2c5e4a` |
| `packages/timeline/src/professional.ts`             | `48445f39992d55a3fd9ec4dd6a07ec548c8a61fecb6e75a4d208faed3018411d` |
| `packages/timeline/src/source-edit.ts`              | `d660380078bbf3dcf50f2a636aa721e830fc173d65be3f25108f348adb8a6d27` |
| `packages/audio/src/commands.ts`                    | `57a90f27cda32ed1301579db26c955d8b22aff7440a59a8b2a811b95422e0b3f` |
| `packages/audio/src/meter-history.ts`               | `95a9225d5785cec2e656d7bfd989a892e5a41caa951ce5332d2babf540d040ca` |
| `apps/studio-web/src/professional-edit-bar.tsx`     | `0bb4ac3f56c49e79e4f397b2145c7c26fb8b1a53a205dc67f7e14da5f7168e5a` |
| `apps/studio-web/src/source-inspection-monitor.tsx` | `0d5ff0920780a695b67cdd47cd902009417609a330a877ea85f1dc1a2f44d298` |
| `apps/studio-web/src/bridge-editor-panel.tsx`       | `19397661ea20a322b2d44e53aa240ccca0ebeb5bec01d9b684c0d7318e36c8c5` |
| `docs/PROFESSIONAL_EDITING.md`                      | `0cf95ae3786bb9ea8d6026cafe7386c3f26db31eb5d8ea0ed3073b89fe36b8e1` |
| `scripts/run-p25-gate.mjs`                          | `44f41588ddc56e7b4718a3d1faa92270ae71e4781eeb1f689616bee3b6853395` |
| `pnpm-lock.yaml`                                    | `6d54108aa85745ba1419e28ba5425fae5b62c17767239817f2a5d33a1b3bc689` |

## Controlled boundaries

- Every professional operation remains a normal command with exact inverse history, immutable persistence, selection reconciliation, and reopen parity.
- Source transport never seeks the master clock. Preview and render use the same time-remap evaluator and explicit audio policy.
- Compounds and inactive takes retain dependency identity; range effects and bridges invalidate only declared affected ranges.
- UI tests remain bound to `playwright-managed:chromium-1228`; real-engine gates remain bound to `playwright-managed:chromium_headless_shell-1228`. Installed Google Chrome and persistent user profiles remain prohibited.
- P26 optimization may change implementation cost, not exact output, authority, recovery, security, QA, or degradation truth.

P26 may now measure and optimize supported project/hardware classes, resource ceilings, accessibility, shortcut customization, and honest degradation without weakening P04-P25 contracts.

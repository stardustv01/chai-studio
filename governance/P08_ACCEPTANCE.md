# P08 acceptance — Studio web shell and shared UI architecture

**Decision:** APPROVED for P09 implementation  
**Decision time:** 2026-07-15T15:29:42Z  
**Supported baseline:** personal-use macOS, 1180×720 minimum desktop viewport  
**Gate identity:** `e99c7c197fe4d63f231f2b71a819bb6a34f3b7c5c6fee619e4079de8a054b96e`

The P08 gate passed all 13 formal checks in one run: frozen offline install, web-shell contract, schema drift, strict lint/format/boundaries, strict compilation, unit, property/fuzz, integration and visual-manifest regression tests, fixture golden verification, real-browser behavior and UI-golden checks, production build, and security inspection. The accepted repository has 144 unit tests, eight property/fuzz tests, 46 integration tests, one fixture visual test, six Chrome end-to-end tests, and 13 macOS UI golden screenshots.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                                                                                                                        |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P08.01 | PASS   | React, TypeScript, and Vite load five URL-addressable workspace boundaries; panel-level error boundaries isolate failures and expose local recovery without blanking the editor.                                                                                                                                           |
| P08.02 | PASS   | `STATE_ARCHITECTURE.md` separates server snapshots, transient interaction, transport, commands, query caches, layout preferences, diagnostics, and performance data; project authority is never duplicated into an uncontrolled client model.                                                                              |
| P08.03 | PASS   | The typed API client validates common envelopes, adds correlation/authentication headers, classifies stale revisions, and refuses protected calls without a local session. The fetch-based SSE client supports authenticated ordered resume, duplicate rejection, reconnect backoff, replay-loss resync, and cancellation. |
| P08.04 | PASS   | Machine-readable dark-theme tokens and shared button, icon, badge, status, field, progress, notice, and empty-state primitives expose focus, disabled, busy, warning, danger, and accessible semantics.                                                                                                                    |
| P08.05 | PASS   | The top bar exposes project/revision identity, all five workspaces, authoritative timecode/frame context, preview/proxy truth, render state, capture, and render actions. Contract-mock data is visibly labeled and never presented as live project authority.                                                             |
| P08.06 | PASS   | Left, right, and lower panels resize, collapse, persist per workspace in versioned local storage, normalize unsafe dimensions, reset to defaults, and preserve monitor/timeline priority at 1180×720 with zero horizontal overflow.                                                                                        |
| P08.07 | PASS   | One conflict-audited command registry routes macOS shortcuts by scope/workspace, suppresses editor actions during text entry, exposes readable key labels, and drives the command palette without duplicated mutation logic.                                                                                               |
| P08.08 | PASS   | Toasts, actionable notices, isolated panel failures, diagnostics drawer, progress, repair/resync actions, correlation IDs, and explicit render-preflight messaging cover error and work states without fake success.                                                                                                       |
| P08.09 | PASS   | Empty, loading, offline, reconnecting, migrating, recovering, read-only, and conflict surfaces remain keyboard-operable and keep their workspace safely mounted. Each state and each workspace has a frozen macOS golden.                                                                                                  |
| P08.10 | PASS   | Bounded local-only instrumentation records React commit cost, browser long tasks/measures, ordered event lag, connection attempts, and interaction diagnostics without telemetry or external network access.                                                                                                               |

## Authoritative evidence identities

| Artifact                               | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `evidence/p08/gate-report.json`        | `ce287e0ccc6ac6ac39ac6e91d543221c35cfe2b536def5c47f5aa4601829b91a` |
| `apps/studio-web/src/App.tsx`          | `aa6fc2dd0764c4a1b517010ea9e20ac7eb6b9fbb4f04c2584d02043a23a75d2f` |
| `apps/studio-web/src/styles.css`       | `c1157ba90184139d8f578495233e71811f8020e4d48e05dfa0cd6d5e0cbc351b` |
| `apps/studio-web/src/api-client.ts`    | `64965e0befdca1eb0c7b6551ee069a9e2b456ce0c345ce96bb2700b32111b484` |
| `apps/studio-web/src/event-stream.ts`  | `4ae5277a5cf0a9b45cf0de3c548566307d380cfc1f661903ddf9d8e33c0e1a15` |
| `apps/studio-web/src/layout-store.ts`  | `bf8eed43cce8e95debfc2f86bd13ff4bf867bcbaa138f764c1011acaea80af5f` |
| `apps/studio-web/src/shortcuts.ts`     | `a47cb973ee5a60f61a5e31a32f83fc020155f4be6130547dfb678b1e3a591431` |
| `packages/ui-components/src/index.tsx` | `23e706b00de0334ea198d0fe05909fdb40542e9a7ace43d7cde1d6ba1304dade` |
| `tests/e2e/studio-visual.spec.ts`      | `2abe401211802380210ed336aae04dfbb3ebe9e291b97b63cf8e0d5809065443` |
| `scripts/run-p08-gate.mjs`             | `cdfbffb3c650aa95b6f3ede2612bc0b78c77edab4b5f04d9906c2091f3e3dc64` |
| `pnpm-lock.yaml`                       | `0ce5cc39ef22ee8d3e78290ecfff800e43c5a197485aa405520c6548b0d49091` |

The gate report additionally hashes every accepted P08 implementation/test file and every one of the 13 Darwin PNG goldens. This avoids silently accepting a screenshot or component change under the same phase identity.

## Controlled boundaries

- The Studio web app is a projection and command surface. Server snapshots, immutable revisions, preview state, jobs, QA, approval, and receipts retain authority.
- When a launcher-authenticated session is unavailable, the shell uses visibly labeled contract-mock data. Mock content validates layout and contracts only; it cannot imply an open project, accepted edit, render completion, QA pass, approval, or delivery.
- The five P08 workspace compositions are production shell surfaces, not claims that later editor/render features are complete. P09-P21 must replace placeholder content with accepted preview, adapter, monitor, timeline, inspector, media, animation, inspect, and delivery implementations.
- Versioned local-storage layouts, toasts, query caches, selection drafts, diagnostics, and performance samples are browser-local and non-authoritative. Deleting them cannot alter project meaning.
- Codex remains the only conversation surface. Inspect exposes a bounded context manifest and visual evidence, never an embedded chat panel.
- The 13 UI goldens are macOS/Chrome baseline evidence at 1440×900; browser inspection separately verified the supported 1180×720 minimum with zero overflow/overlap. Later intentional visual changes require new gate evidence.
- Client instrumentation remains local and bounded. External telemetry, remote origins, and undisclosed network access remain forbidden.

P09 may now replace the shell's preview contract mock with one authoritative frame scheduler, compositor, preload/buffering policy, explicit approximation/fidelity modes, and deterministic mixed-engine preview lifecycle.

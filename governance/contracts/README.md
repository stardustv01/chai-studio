# Chai Studio P02 frozen contract index

**Status:** Frozen v1 for the personal macOS baseline  
**Freeze gate:** P02.16–P02.24  
**Change rule:** A replacement version requires an ADR, impact analysis, migration plan, affected tests, and explicit approval. Existing receipts retain their original contract identities.

| Contract                       | Version | Owner                                       | Primary consumers                        |
| ------------------------------ | ------: | ------------------------------------------- | ---------------------------------------- |
| Audio transport                |       1 | `audio-core` with `timeline-core` authority | preview, adapters, render                |
| Command authorization          |       1 | `command-core`                              | UI, local API, CLI, Codex bridge         |
| QA and delivery lifecycle      |       1 | `qa-core`                                   | render, Deliver UI, receipts             |
| Caption rendering              |       1 | `caption-core`                              | preview, compositor, subtitle export, QA |
| Executable trust and isolation |       1 | `security-core`                             | adapters, workers, render, cache         |
| Privacy and diagnostics        |       1 | `diagnostics-core`                          | logs, bridge, receipts, support bundles  |
| Shared preflight               |       1 | `preflight-core`                            | planner, Deliver UI, QA                  |
| Source-monitor boundary        |       1 | `source-monitor`                            | UI, command routing, timeline            |
| Render receipt and evidence    |       1 | `render-core`                               | QA, Deliver UI, release                  |

Machine-readable ownership and dependency direction live in `contract-index.json`. `validate-contract-index.mjs` must report no missing dependencies and no cycles before production phases proceed.

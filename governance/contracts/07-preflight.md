# Frozen contract 07 — Shared preflight v1

One `preflight-core` rule engine serves the render planner, Deliver UI, API/CLI, and QA report. A result contains rule ID/version/category, severity (`blocking`, `warning`, `info`), affected stable IDs, human message, machine details, repair action, evidence, and deterministic policy context.

The shared model covers schema/migrations, assets and hashes, fonts/glyphs, adapter capabilities, proxies/originals, alpha, central audio, captions, rights, trust/isolation, disk, output roots, delivery profile, strict/compatible environment, and dependencies. Blocking results stop expensive work. Warnings require visible acknowledgement and may require a scoped lifecycle exception; info is evidence only. The planner may select native, shared, baked, bridge, fallback, experimental, or unsupported paths only from the capability registry and must expose every approximation/fallback before execution.

Evidence: `src/preflight-engine.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/preflight-result.json`.

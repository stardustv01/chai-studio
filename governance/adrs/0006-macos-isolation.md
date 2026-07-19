# ADR 0006 — Imported-code containment on macOS

**Status:** Accepted for the personal macOS baseline

Imported executable compositions run in a distinct worker identity using macOS `sandbox-exec` for network denial, the Node permission model for approved filesystem roots and process/worker denial, a sanitized environment, V8 heap caps, and parent-enforced wall-time/output budgets. Trusted and untrusted caches and provenance remain separate. Imported support stays disabled if the recorded profile is unavailable or its adversarial evidence is stale.

Evidence: `evidence/isolation-report.json`, `src/security-policy.mjs`, and `fixtures/untrusted/`.

Rejected: renderer trust based on successful output, environment inheritance, broad home-directory access, and network-enabled imports. Limitation: `sandbox-exec` is macOS-specific and deprecated by Apple; any future platform or replacement mechanism requires a new ADR and adversarial matrix at P23.

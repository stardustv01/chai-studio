# Frozen contract 06 — Privacy, redaction, and diagnostics v1

No unsolicited telemetry is transmitted. Local diagnostics use project-relative paths; unrelated home paths become `<home>` or a stable redacted external reference. Tokens, API keys, secrets, passwords, authorization headers, non-allowlisted environment values, and source text not required for diagnosis are redacted before persistence.

Default local retention is 30 days or 1 GiB, whichever is reached first; users may choose shorter retention or clear it. Render receipts retain only reproduction-required declared data and hashes. Crash records remain local. A support bundle is created only by explicit action, shows a preview manifest before export, excludes source media and executable source by default, and records selected inclusions. Bridge logs cannot push conversation content and retrieve context only through explicit scoped requests.

Evidence: `src/privacy-redaction.mjs`, `evidence/privacy-redaction-result.json`, isolation environment assertions.

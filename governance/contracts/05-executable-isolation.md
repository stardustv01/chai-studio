# Frozen contract 05 — Executable trust and isolation v1

Trust classes are `trusted_authored` and `imported_untrusted`. Successful rendering never promotes trust. Imported support is enabled only when the current supported-platform profile and adversarial evidence pass.

The macOS v1 imported worker uses a separate process identity, `sandbox-exec` network denial, Node permissions for canonical approved read/write roots and child/worker denial, sanitized environment, read-only sources unless declared, V8 heap limit, parent wall-time and output/log caps, loopback/service denial, separate browser profile/temp/cache, and provenance carrying the policy identity. Symlinks resolve before root checks. Navigation, popups, downloads, external protocols, broad `file://`, and undeclared environment/network are denied.

Violations record policy/version, worker/job/composition, attempted capability and redacted target, enforcement mechanism, timestamp, termination/result, and correlation ID. Trusted and untrusted caches are never interchangeable. P23 re-runs and hardens the adversarial matrix; a missing/deprecated enforcement mechanism disables imported execution instead of weakening policy.

Evidence: `evidence/isolation-report.json`, `src/security-policy.mjs`, `fixtures/untrusted/`, ADR 0006.

# ADR 0007 — Environment identity and cache reuse

**Status:** Accepted

Final artifacts require the strict fingerprint: OS/architecture/hardware class, full tool and renderer versions, browser, locale/timezone, memory class, and lockfile hash. Preview artifacts may use a compatible fingerprint with a visible degradation state. HyperFrames `0.x` compatibility is pinned to the `major.minor` line, not major zero. No artifact portability is assumed without evidence.

Evidence: `evidence/environment.json` and `tests/policy-environment.test.mjs`.

Rejected: engine-version-only cache keys, compatible reuse for final output, and silent cache reuse after lockfile/environment change.

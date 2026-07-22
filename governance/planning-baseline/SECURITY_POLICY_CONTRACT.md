# Chai Studio — Security Policy Contract Draft

**Status:** Verified for the personal macOS baseline at P23; public distribution remains release-review blocked

## Trust classes

- `trusted_authored`
- `imported_untrusted`

Promotion requires explicit review and never occurs from successful rendering alone.

## Default policy

- Bind the server to loopback.
- Require local session authorization and allowed origins.
- Restrict files to canonical approved roots and handle symlinks explicitly.
- Deny network and environment access by default.
- Prevent navigation, popups, downloads, external protocols, broad `file://`, and unapproved local services.
- Use read-only source mounts when writes are unnecessary.
- Bound CPU, memory, wall time, process count, disk output, and log size.
- Separate trusted/untrusted workers, browser profiles, temporary roots, caches, and artifact provenance.

## Command authorization

Read-only inspection and capture may be automatic. Normal mutations require validated commands and current `baseRevisionId`. Destructive deletion, project-wide replacement, external publishing, or broader access requires explicit authorization.

## Privacy

Logs, bridge manifests, diagnostics, and receipts use project-relative paths and redact secrets, unrelated home paths, tokens, and non-allowlisted environment values. No telemetry is transmitted by default.

## Release rule

Imported-untrusted support remains disabled unless adversarial fixtures pass on every supported platform and the enforcement identity is recorded in output provenance.

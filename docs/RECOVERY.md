# Chai Studio recovery guide

Status: P24 macOS personal-use recovery contract.

The project folder is the authority. Immutable revisions, `current-revision.json`, receipts, approvals, and registered asset hashes are preserved during recovery. `.chai-cache` and incomplete render outputs are regenerable. Recovery never silently deletes creative source.

## Startup health

Open **Local diagnostics** and choose **Run health scan**. The scan checks the Playwright-managed headless browser without launching installed Chrome, frozen Remotion and HyperFrames versions, adapters, FFmpeg and required codecs, the macOS backend, registered fonts, project and temporary write access, free disk space, and project integrity.

- **Blocking** means editing or rendering must stop because authority or a required runtime is unsafe.
- **Repairable** means an explicit recovery action is available.
- **Degraded** means the project can remain open, but a capability is outside its preferred contract.

## Read-only repair scan

The repair scan reports orphan or invalid revisions, interrupted staging folders, stale locks, missing or changed assets and fonts, external native-source edits, corrupt caches, incomplete renders, interrupted jobs, and recoverable autosaves. Running a scan changes no files. Every mutation requires choosing a specific issue and action.

Repairs create a receipt under `receipts/repairs/`. Removed queue or cache material is quarantined or explicitly identified as regenerable. Project media and native source are never accepted, replaced, or deleted implicitly.

## Recovery procedures

### Interrupted render or worker crash

1. Open Local diagnostics and inspect the affected job, stage, and correlation ID.
2. Retry the failed stage only when **Safe retry** is shown.
3. The retry reads the prior recovery journal and reuses only artifacts whose path, size, and SHA-256 still match.
4. Cancelled or failed partial output is retained for inspection and later explicit quarantine. It is never exposed as a completed output.

### Missing asset or font

1. Select the reported asset or font.
2. Choose a replacement path only when it contains the exact registered SHA-256 bytes.
3. Use **Relink** for identical bytes. Use the normal explicit **Replace** workflow for different bytes so dependent caches are invalidated.

### External native-source edit

1. Inspect the working source and compare it with the immutable revision.
2. If intentional, choose **Adopt external source**. Chai Studio hashes the current file again and commits it through `source.edit` into a new revision.
3. If it changed again during review, adoption stops. Nothing is partially committed.

### Stale lock

Clear a lock only after its recorded expiry. The lock is moved into repair quarantine with evidence; a live lock is never overridden.

### Invalid current pointer

Use pointer recovery only when the current pointer is missing or invalid. The recovery scanner lists immutable revision directories that fully parse and hash correctly. Choose one verified candidate and provide a reason. A valid current pointer cannot be replaced through this recovery path.

### Autosave after an unclean shutdown

Restore only a hash-verified autosave based on the current revision. Restoration commits a new immutable revision. A corrupt or stale autosave is shown but cannot be restored.

### Corrupt cache

Quarantine the exact reported cache entry, then rerun the affected operation. Cache rebuilds from immutable revisions, registered assets, exact engine identities, and the current environment fingerprint. Deleting `.chai-cache` must not change the current revision hash.

## Backup, restore, and move

1. Close Chai Studio cleanly.
2. Copy the complete `.chai` project folder to a local backup location. Preserve permissions and do not omit hidden files.
3. Verify the copied `current-revision.json` and its target revision by opening the copy or running the repair scan.
4. Restore by copying the complete folder to a new location. Open the restored folder; do not merge two project folders in place.
5. A project may be moved or renamed while closed. On reopen, Chai Studio resolves project-relative paths and revalidates external resources.
6. `.chai-cache` may be removed while closed when cache repair is required. Keep `revisions`, `current-revision.json`, `assets`, `scenes`, `autosaves`, `receipts`, and project documents.

These procedures are exercised by `tests/integration/project-backup-restore.test.ts`, `tests/integration/reliability-repair.test.ts`, and the P24 acceptance gate.

## Diagnostics and privacy

Logs rotate locally and include correlation IDs, stage timing, bounded memory/concurrency samples, media-probe results, engine-console excerpts, and cache reasons. Secrets and personal paths are redacted. Crash records are local only and telemetry is disabled.

A support bundle requires explicit record selection and a redaction preview. It excludes project media and executable source. No upload or external transmission exists in the P24 contract.

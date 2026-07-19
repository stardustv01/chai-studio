# Release candidate checklist

- Verify support matrix, doctor fingerprint, pinned runtimes/engines, lockfile, schemas, licenses/notices, checksums, and manifest.
- Qualify the clean-machine install, launch, create/open/reopen, imports, core/pro edits, bridge context, capture, render/cache, QA, approval, delivery, and reproduction.
- Verify the extracted bundle with its embedded manifest, install it to a separate prefix, move the extracted bundle away, and prove the installed launcher, doctor, authenticated UI, API, and render path remain operational without the development checkout.
- Confirm no Chai source, tests, fixtures, reports, local projects, development dependencies, installed Google Chrome profile, or absolute build-machine path is present in the runtime payload.
- Verify commit/render crash, autosave, stale lock, corrupt cache, missing source/font, low disk, worker/browser failure, permission loss, and backup restore.
- Validate backup/restore/clone/archive, cache exclusion, delivery preservation, cross-machine reporting, and uninstall preservation.
- Run lint, strict types, unit/property/integration/real-engine/visual/E2E/performance/security/license gates using managed isolated browsers only.
- Archive gate, qualification, disaster, upgrade, manifest, and checksum evidence. Any failed item blocks the candidate.

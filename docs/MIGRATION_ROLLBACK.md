# Migration, compatibility, and rollback

Project schema `1.0.0` is current. Version `0.9` migrates only through the deterministic registry after dry-run and canonical backup. Mixed, malformed, and newer unsupported versions show blocking diagnostics; they are never guessed into compatibility.

Before migration, validate a cache-excluding full backup and show irreversible boundaries. Migration publishes a new immutable artifact and retains the original. Rollback is allowed only while the migrated artifact remains hash-identical to the recorded report.

Application rollback restores the previous immutable release, lockfile, manifest, pins, and schema matrix. It cannot downgrade a project across an irreversible boundary; use the compatible release or restore the pre-migration backup into a new folder.

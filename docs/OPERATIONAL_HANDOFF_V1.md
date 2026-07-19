# Version 1 operational handoff

The handoff package consists of the release manifest, doctor/support matrix, installation guide, user/developer guides, migration/rollback policy, upgrade automation, RC checklist, post-release operations, known limitations, backup/restore tools, qualification/disaster reports, P28 traceability, and the final signed receipt.

Before release, run doctor, validate the immutable release manifest, confirm the supported fingerprint, restore a validated sample backup, reproduce the approved sample output, repeat rollback to the prior supported RC, and confirm uninstall preserves projects and deliveries. A fingerprint mismatch allows project restore but blocks an output-reproduction claim.

After release, triage with release/revision/environment/correlation identity; use redacted local support bundles only; follow the security response and regression cadence; validate backups before migration/upgrades; and upgrade one engine family in isolation. Operations cannot skip QA, approval, delivery, authorization, security, license, performance, backup, or change-control gates.

Final authority is the owner-signed `evidence/p28/version-1-release-receipt.json`. A technical gate, traceability matrix, or this handoff document is not release approval.

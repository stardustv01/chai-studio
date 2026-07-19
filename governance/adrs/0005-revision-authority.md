# ADR 0005 — Immutable revisions and source edits

**Status:** Accepted

Every accepted mutation creates an immutable revision directory and changes authority with one atomic pointer replacement. Optimistic concurrency rejects stale bases. Crash-before-pointer leaves the prior revision authoritative; crash-after-pointer leaves the complete new revision authoritative. Orphans are detected by ancestry traversal. Locks expire explicitly.

Native source edits begin from path/content/revision hashes, validate, commit through project revision authority, and then materialize the working source. Unwrapped external changes quarantine the candidate instead of being overwritten or silently rebased.

Evidence: `tests/revision-store.test.mjs` and `src/source-edit-session.mjs`.

Rejected: in-place authoritative JSON/source edits, best-effort multi-file writes, and automatic rebase of visual intent.

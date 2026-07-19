# Chai Studio user guide

Create or open a `.chai` project, then work through Edit, Inspect, Media, Animation, and Deliver. The global truth bar always identifies the revision, frame, preview fidelity, connection, and lifecycle state.

The default first-run project opens with a short welcome that links Play, Edit, and Verify. Dismissing it changes only a local UI preference. The starter media and timeline remain ordinary project content that can be moved, cut, deleted, or replaced.

- Import in Media. Review hashes, VFR/proxy mapping, fonts, rights, missing sources, and relink/replace consequences.
- Edit through the command-driven timeline. Core/pro edits, curves, captions, and audio automation commit through immutable revision history.
- Inspect common/native properties without expressions; review fallback or bake consequences before mutation.
- Treat exact capture and rendered output as fidelity authority. Dropped playback visibly degrades and never claims frame-perfect real time.
- When transport is paused, the authenticated Program monitor requests a hash-checked compositor frame bound to the current revision and master frame. During playback it truthfully labels the last rendered frame against the advancing clock instead of substituting decorative pixels.
- Capture exact revision/frame context for Codex. Stale context is refused.
- Render with exact profile and scope. Rendering creates `rendered_unchecked`; QA, human review, approval, and delivery are separate evidence-backed transitions.
- Reproduce approved output only from its immutable revision, environment, dependency, profile, QA, and receipt identity.

Run diagnostics read-only first for recovery, then follow [RECOVERY.md](RECOVERY.md). Use `chai-studio backup`, `validate-backup`, `restore`, `clone`, or `archive`; caches are excluded while revisions, approvals, receipts, and delivered artifacts are preserved.

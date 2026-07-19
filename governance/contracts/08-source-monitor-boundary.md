# Frozen contract 08 — Source-monitor scope v1

Foundation source monitoring provides inspection, an independent source scrub/frame-step clock, metadata, safe prop/variable audition, isolated source audio, capture, and scoped Codex context. It does not own or advance the master timeline clock.

P25 Professional Expansion implements source marks, target-track patching, insert, overwrite, replace, and three-point edits. Those actions are validated reversible project commands with the current base revision. Source transport state never mutates timeline transport implicitly. A safe audition cannot change authoritative source or project files. Controls unavailable in the current scope are absent or explicitly unavailable; they are never decorative placeholders.

Evidence: `src/source-monitor-scope.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/source-monitor-scope.json`.

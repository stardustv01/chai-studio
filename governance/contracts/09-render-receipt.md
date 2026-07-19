# Frozen contract 09 — Render receipt and evidence v1

A receipt is canonical, hashed, immutable, and complete for its output candidate. Required fields cover project/revision/job and times; delivery profile; engines/adapters and roles; strict environment manifest/fingerprint; dependency and lockfile hashes; cache lineage; output relative paths/bytes/hashes; central audio measurements; caption artifact; preflight and QA states/evidence; warnings/exceptions; approval/delivery identities; and exact reproduction inputs/commands.

Compatible-preview identity may appear for preview artifacts but never substitutes for strict final identity. A render receipt begins with `rendered_unchecked`, null approval, and `delivered: false`. Later lifecycle transitions append or create a new signed evidence record; they never rewrite historical render identity. Secrets and unrelated paths follow contract 06.

Evidence: `src/render-receipt.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/render-receipt.json`.

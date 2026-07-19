# Debugging guide

1. Capture the failing root command and correlation ID.
2. Run the narrow class first (`test:unit`, `test:property`, `test:integration`, `test:visual`, or `test:e2e`).
3. Inspect the structured error fields: category, code, stage, entity, cause, and repair hint.
4. Confirm `.node-version`, `pnpm --version`, lockfile, and strict environment before treating a deterministic mismatch as product drift.
5. For generated/schema failures, edit only the source schema and regenerate. For goldens, render with `--check` before considering an explicit reviewed update.
6. Preserve suite-specific failure artifacts under `reports/playwright` and structured test evidence under `reports`; never paste unredacted secrets or absolute user paths into evidence.

Do not delete project authority while debugging. `pnpm clean-cache` removes only named regenerable build/test caches and deliberately ignores project, governance, fixture source, and spike evidence.

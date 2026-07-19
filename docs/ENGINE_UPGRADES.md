# Engine and adapter upgrades

Remotion and HyperFrames are exact pins. Upgrade only one family in an isolated `upgrade/<engine>/<version>` branch or worktree. Do not edit the other pin or accepted evidence unless the selected upgrade proves a required change.

Run `node scripts/run-p27-upgrade-check.mjs --engine remotion --candidate VERSION` or the HyperFrames equivalent. Automation checks the selected pin, strict types, adapter contracts, capability identity/diff, golden checksums, audio-sync coverage, M4 budgets, security, licenses, and writes a local receipt. The formal release gate still runs both real engines.

Accept only after discovery, preview, exact capture/range, render parity, diagnostics, cancellation, cache/trust identity, license, and performance evidence pass. On failure, roll back the isolated worktree and prior lockfile; never widen tolerances or reinterpret an old receipt.

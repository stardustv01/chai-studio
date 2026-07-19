# Release developer guide

The monorepo separates schema, timeline, media, audio, captions, adapters, preview, render, review, QA, security, diagnostics, server, web, and shared UI packages. Package boundaries are executable. Generated schemas, capability identity, fixtures, browser isolation, licenses, budgets, and release checks are gate inputs.

An edit flows from accessible UI command to typed envelope, base-revision/authorization checks, exact transformation, whole-project validation, crash-safe immutable publish, pointer advance, ordered event, resync, and undo receipt. A render flows from exact revision/profile/scope through registry/security preflight, content-addressed DAG/cache, native/shared/caption/bridge/audio/encode nodes, atomic artifacts, QA evidence, lifecycle review, and immutable receipt.

Start with [architecture.md](architecture.md), [debugging.md](debugging.md), [fixtures.md](fixtures.md), schema sources, command registries, capability registry, worker supervisor, preview scheduler, render DAG/store, QA rules, and phase acceptances. Reproduce with exact fixture/revision/environment identity and correct the earliest failing contract.

The release pipeline verifies lockfile, schemas, all tests, real engines, visual goldens, budgets, security, licenses, production build, manifest, qualification, backup/restore, and disaster drills. `evidence/p27/release-manifest.json` traces production bytes to accepted evidence.

Build the end-user runtime only from a committed candidate:

```sh
CI=true corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm release:bundle
corepack pnpm release:archive -- dist/releases/chai-studio-1.0.0-rc.2-darwin-arm64
```

`release:bundle` uses pnpm's offline production deploy, repairs and validates workspace links, excludes Chai development source/reports/tests, adds the compiled web application and runtime documentation, and seals every file and symlink in `.chai-studio-release.json`. The resulting CLI serves the web build without Vite. `install` copies that complete bundle into the chosen prefix and verifies it again; pointing back to a development checkout is forbidden.

The archive receipt is technical evidence only and keeps `releaseAuthorized: false`. Owner approval, release signing, final-gate binding, and the stable tag happen only after qualification and human review.

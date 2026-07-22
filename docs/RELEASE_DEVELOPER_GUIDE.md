# Release developer guide

The monorepo separates schema, timeline, media, audio, captions, adapters, preview, render, review, QA, security, diagnostics, server, web, and shared UI packages. Package boundaries are executable. Generated schemas, capability identity, fixtures, browser isolation, licenses, budgets, and release checks are gate inputs.

An edit flows from accessible UI command to typed envelope, base-revision/authorization checks, exact transformation, whole-project validation, crash-safe immutable publish, pointer advance, ordered event, resync, and undo receipt. A render flows from exact revision/profile/scope through registry/security preflight, content-addressed DAG/cache, native/shared/caption/bridge/audio/encode nodes, atomic artifacts, QA evidence, lifecycle review, and immutable receipt.

Start with [architecture.md](architecture.md), [debugging.md](debugging.md), [fixtures.md](fixtures.md), schema sources, command registries, capability registry, worker supervisor, preview scheduler, render DAG/store, QA rules, and phase acceptances. Reproduce with exact fixture/revision/environment identity and correct the earliest failing contract.

The release pipeline verifies lockfile, schemas, all tests, real engines, visual goldens, budgets, security, licenses, production build, manifest, qualification, backup/restore, and disaster drills. `evidence/p27/release-manifest.json` traces production bytes to accepted evidence.

Build the end-user runtime only from a committed candidate:

```sh
CI=true corepack pnpm install --frozen-lockfile
corepack pnpm release:build
corepack pnpm release:bundle
corepack pnpm release:archive -- dist/releases/chai-studio-1.0.0-rc.4-darwin-arm64
```

`release:bundle` uses pnpm's lockfile-frozen, store-preferred production deploy, removes package-manager and TypeScript build metadata, repairs only relocatable internal links, embeds the reviewed HyperFrames runtime, excludes Chai development source/reports/tests, adds the compiled web application and runtime documentation, starts the embedded HyperFrames CLI as a smoke test, and seals every file and symlink in `.chai-studio-release.json`. The resulting CLI serves the web build without Vite. `install` copies that complete bundle into the chosen prefix and verifies it again; pointing back to a development checkout is forbidden.

The archive receipt is technical evidence only and keeps `releaseAuthorized: false`. Owner approval, public-distribution review, release signing, final-gate binding, and the exact candidate tag happen only after qualification and human review.

The protected tag job is fail-closed and does not run for branch-only workflow dispatches. It rebuilds and verifies the self-contained runtime from the P27 manifest's frozen source commit, checks the in-repository frozen planning snapshot and contract identities without rewriting them, runs a fresh macOS isolation probe in read-only mode, validates the exact dependency inventory and P27 manifest, and then invokes both P28 technical and final-contract validators. A later evidence/authority commit may reference that frozen source only when every intervening tracked change is under generated evidence or one of the two exact human-authority record paths; any application, dependency, script, documentation, or policy change rejects the historical source identity. The final validator requires an already bound final-gate identity; CI never creates approval, review, signature, or authorization records.

The job also requires a Git tag ref exactly equal to `v${package.version}` and checks the P28 version manifest after the production build. Release identity comes from the tracked typed diagnostics identity JSON, not source-text matching. Dependency inventory identity and bytes plus public-distribution-review identity and bytes are bound through the final manifest, preapproval receipt, signed receipt, and final validator. The final manifest also hashes the complete generated registry runtime and every publishable CLI source file. P28 gate-report identities are recomputed from their full pass state and check outcomes; a failed, mutated, empty, or merely relabeled report is rejected.

`validate-task-graph.mjs` and `validate-contract-index.mjs` are read-only by default (`--check` is accepted for explicit CI intent). Only an approved evidence refresh may pass `--write`; running either validator normally never repairs or conceals drift.

The owner approval must name the exact source version and distribution scope. For RC4 the required statement is `I explicitly approve and authorize Chai Studio 1.0.0-rc.4 for public release.` This statement belongs in `governance/V1_OWNER_APPROVAL.json`; choosing a target in conversation does not create that authorization record. Public distribution also requires `governance/licenses/public-distribution-review.json`, bound to the exact dependency inventory identity. Start from the templates in `governance/templates`, but never treat a template as approval.

After the immutable P27/P28 evidence is current, the signing sequence is:

```sh
corepack pnpm p28:sign
corepack pnpm p28:gate
corepack pnpm p28:bind-gate
node scripts/validate-p28-final-contract.mjs --require-final-gate
```

`p28:sign` creates `~/.config/chai-studio/release-signing-ed25519.pem` with mode `0600` only after every pre-signing check passes. Never commit, upload, or paste this private key. Back it up in encrypted owner-controlled storage. Its public key is written to `evidence/p28/version-1-release-public-key.pem` and may be committed.

The registry CLI is configured with `private: false` and public npm access. Its prepack step bundles
Chai workspace server code, copies the compiled browser payload, and vendors the reviewed
HyperFrames 0.7.58 CLI/runtime subset. Other Node-side third-party libraries remain exact npm
dependencies. This configuration permits publication but does not
perform or authorize it. Validate the complete tarball, included licenses, runtime marker, and
absence of `node_modules` with `pnpm cli:package:check`. Before generating or checking the P28
version manifest, run `pnpm run cli:runtime:build`; the protected tag workflow does this explicitly so
the signed manifest binds the exact runtime bytes. Publish one inspected `.tgz` produced from that
candidate rather than rebuilding during `npm publish`.

The signed HTTPS archive index is a legacy personal-install mechanism. Its generator now refuses the
current `personal-local-only` bundle and can accept only a separately reviewed
`public-prebuilt-runtime` archive. The public npm path does not use that archive. Making the registry
package publishable, creating the exact Git tag, creating a GitHub release, and publishing npm remain
separate explicit owner actions after final authorization.

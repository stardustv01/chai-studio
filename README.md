# Chai Studio

macOS-first local professional video studio operated through Codex.

## Current implementation state

The full editor, authenticated launcher, compositor, render/QA lifecycle, professional editing,
recovery, and local Codex bridge are implemented. Release candidate `1.0.0-rc.2` is currently in
clean-build and standalone-package qualification.

RC1 reports and owner feedback are historical and live under `archive/`; they are not acceptance
evidence for RC2. Fresh P27 and P28 technical evidence must be generated from the exact immutable
RC2 bundle. No stable release, owner approval, signature, final authorization, or public-distribution
authority has been issued.

## Local developer loop

```sh
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm release:bundle
pnpm dev
```

The release bundle contains its own compiled application and production dependencies. Its launcher
does not depend on this development checkout. See [docs/INSTALLATION.md](docs/INSTALLATION.md) and
[docs/RELEASE_DEVELOPER_GUIDE.md](docs/RELEASE_DEVELOPER_GUIDE.md).

The planning authority remains in the parent directory:

1. `../CHAI_STUDIO_MASTER_PLAN.md`
2. `../CHAI_STUDIO_FINAL_UPDATED_IMPLEMENTATION_PLAN.md`
3. `../PROJECT_STATE.md`

## Gate discipline

- No rich editor implementation may bypass the accepted task dependency graph.
- Every authoritative edit position uses integer master frames.
- Every persisted rate uses a normalized rational value.
- Project revisions are coordinated immutable snapshots.
- Remotion and HyperFrames remain native behind product-owned adapters.
- Interactive preview never masquerades as rendered fidelity.
- Encoding never implies QA, approval, or delivery.

# Chai Studio CLI

This package is the small, registry-facing installer for Chai Studio. It does not contain the
application runtime. It resolves an authorized release record, verifies its Ed25519 signature,
downloads the matching immutable archive, verifies the archive SHA-256 and byte count, and then
delegates installation to the archive's integrity-checking installer.

The package is intentionally private until public-distribution licensing, a trusted production
release key, owner approval, and registry provenance are complete.

Planned public usage:

```sh
npx @chai-studio/cli@latest install --launch
npx @chai-studio/cli@latest doctor
npx @chai-studio/cli@latest launch
```

Users who prefer a persistent global command may install the same package with
`npm install --global @chai-studio/cli` and then use `chai-studio` directly.

Development builds must provide `--release-index` and `--public-key`. File URLs and unsigned
release records are never accepted by the executable.

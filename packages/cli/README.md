# Chai Studio CLI

This Apache-2.0 package is the registry-facing installer and launcher for Chai Studio. It contains
the compiled Chai-owned server and browser payload so `npx` can launch the editor without cloning the
repository. Node-side third-party runtime libraries are exact npm dependencies; FFmpeg remains a
system tool, and Playwright downloads its managed Chromium only after an explicit install command.

The package is configured for public npm access. Publication is still a separate release action and
must use an exact validated candidate with owner approval and provenance. Third-party packages must
be obtained from their original registries under their own terms. FFmpeg/FFprobe must be provided by
the user's system and are checked by `chai-studio doctor`.

Planned public usage:

```sh
npx @chai-studio/cli@latest install --launch
npx @chai-studio/cli@latest doctor
npx @chai-studio/cli@latest launch
```

Users who prefer a persistent global command may install the same package with
`npm install --global @chai-studio/cli` and then use `chai-studio` directly.

The signed archive installer remains only as a legacy personal-development fallback when the packaged
registry runtime is absent. It does not authorize publishing the current personal self-contained
archive. File URLs and unsigned release records are never accepted by that fallback.

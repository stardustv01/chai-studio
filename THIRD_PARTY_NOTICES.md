# Third-party notices

Chai Studio's original source is licensed under Apache License 2.0. That license does not
replace, relicense, or weaken the terms of any third-party component.

## Distribution boundaries

The public Chai Studio source repository does not include `node_modules`, package-manager stores,
managed browser downloads, FFmpeg binaries, or generated application bundles. Users obtain
dependencies from their original publishers under those publishers' terms.

The registry CLI contains compiled Chai Studio server and browser code. Node-side third-party
libraries are normally declared as exact npm dependencies. The reviewed HyperFrames 0.7.58 CLI and
frame-runtime files are copied into `runtime/vendor/hyperframes` under Apache License 2.0 so the
public installer does not inherit HyperFrames' unrelated optional dependency tree.
The browser payload contains the production builds of React, React DOM, and Scheduler; their MIT
license text is shipped at `apps/studio-web/dist/third-party/react-mit.txt`. The application payload
also includes the font and artwork described below. It does not include FFmpeg or Chromium.

The exact dependency and license inventory for the release candidate is generated at
`governance/licenses/dependency-inventory.json`. That machine-readable inventory is authoritative
for versions and detected package metadata; this document summarizes the main runtime boundaries.

## Major runtime components

- **Remotion 4.0.489** — Remotion License. Chai Studio uses the published Remotion packages without
  relicensing them. Eligibility and usage remain subject to the exact Remotion terms:
  <https://github.com/remotion-dev/remotion/blob/v4.0.489/LICENSE.md>.
- **HyperFrames 0.7.58** — Apache License 2.0, according to the installed package metadata recorded
  in the dependency inventory.
- **React 19.1.0, React DOM 19.1.0, and Scheduler 0.26.0** — MIT License. Their production browser
  code is bundled by the web build, and the required MIT text remains in the distributed payload.
- **Ajv 8.20.0** — MIT License, installed directly from npm for runtime schema validation.
- **Sharp 0.35.3** — Apache License 2.0, installed directly from npm. Its transitive native runtime
  packages retain their own notices and package metadata.
- **FFmpeg/FFprobe** — externally installed system tools. Chai Studio does not grant rights to
  FFmpeg or codecs. The applicable LGPL/GPL configuration and any codec or patent obligations are
  determined by the user's exact build: <https://ffmpeg.org/legal.html>.
- **Playwright-managed Chromium** — development and QA tooling, downloaded separately and excluded
  from the public Chai Studio source distribution and end-user application payload.

## Fonts and application artwork

- **Noto Sans Devanagari** Regular, Medium, and SemiBold — Copyright 2022 The Noto Project Authors,
  SIL Open Font License 1.1. The complete OFL text is shipped beside the fonts at
  `apps/studio-web/dist/fonts/OFL.txt`.
- **Chai Studio application icon and Chai UI icon set** — Chai-owned project artwork released by
  the owner with the Chai Studio source under Apache License 2.0. The distributed icon manifest
  records the exact source-manifest identity and per-file hashes.

All other dependencies retain the licenses and notices identified by their original packages.
Before distributing any prebuilt runtime, regenerate the inventory and collect the complete license
texts, attribution notices, binary build configuration, and corresponding-source obligations for the
exact payload. A source release does not authorize a prebuilt third-party binary bundle.

# Support matrix and local launch

Version `1.0.0-rc.3` has one measured production class: macOS 26.x on arm64 Apple M4 with 16 GB unified memory and integrated M4 GPU, Node 22.17.0, FFmpeg/FFprobe 7.1.1, Playwright-managed Chromium 1228 for UI QA, and the matching managed headless shell for engine work. `fixtures/release/support-matrix.json` is the machine-readable authority.

Other arm64 Macs can be reported only as `compatible-unmeasured` after `chai-studio doctor` passes. They do not inherit M4 performance claims. Non-macOS, x64, old Node, missing FFmpeg, or missing isolated browsers are blocked.

The application is a loopback-only Studio server plus local web UI. It requires no cloud account and no desktop wrapper. `chai-studio launch` runs the API and production web build on `127.0.0.1`, prints the URLs, and does not open any browser automatically. Installed Google Chrome is never selected by test or engine policy.

# Third-party notices

The Chai Studio CLI package includes compiled Chai-owned installer, server, and browser code. Chai
Studio's Apache License 2.0 does not replace the license of any third-party component.

Node-side runtime libraries—including Remotion 4.0.489, Ajv 8.20.0, and Sharp 0.35.3—are declared as
exact npm dependencies and are installed from the npm registry. They are not copied into the Chai
server bundle. Playwright installs its managed Chromium only after the user runs the install command.
FFmpeg and FFprobe remain external system tools and are never included in this package.

The browser payload bundles React 19.1.0, React DOM 19.1.0, and Scheduler 0.26.0 under the MIT
License. The MIT text is included at `runtime/apps/studio-web/dist/third-party/react-mit.txt`.

The payload also contains Noto Sans Devanagari Regular, Medium, and SemiBold under SIL Open Font
License 1.1. The complete font license is included at
`runtime/apps/studio-web/dist/fonts/OFL.txt`. Chai-owned application and UI icons are distributed
with the Chai Studio source under Apache License 2.0.

The exact release-candidate dependency metadata is included in
`runtime/governance/licenses/dependency-inventory.json`. Every dependency retains its publisher's
license, notices, restrictions, and obligations.

# V2 asset manifest

| Asset | Intended use |
| --- | --- |
| `masters/chai-lockup-color.svg` | Primary bilingual product lockup |
| `masters/chai-lockup-mono.svg` | One-colour lockup and masks |
| `masters/chai-wordmark-color.svg` | Devanagari signature without English companion |
| `masters/chai-symbol-color.svg` | Compact UI symbol without a tile |
| `masters/chai-symbol-mono.svg` | One-colour compact symbol |
| `masters/chai-app-icon.svg` | Approved compact symbol on the midnight app tile |
| `index.html` | Canonical 2.4-second motion proof |
| `compositions/index.html` | HyperFrames-discoverable composition copy |
| `proof/reference-compare.png` | Static fidelity review board |
| `snapshots/contact-sheet.jpg` | Exact-time motion review board |

## Palette

- Midnight: `#070A12`
- Ivory: `#F5EFE2`
- Tea amber: `#F2B33F`
- Fresh cyan: `#19D9EA`

## Source and non-shipping material

`work/`, `scripts/`, `proof/approved-*.png`, `node_modules/`, and the concept
rasters are reconstruction inputs or diagnostics. They must not be copied into
the application bundle.

## Integration restrictions

- Preserve the reconstructed paths; do not replace them with font text.
- Preserve the exact final silhouette and playhead position.
- Do not add steam, a cup, leaf, flame, glow spectacle, bounce, or a loop.
- Do not move any asset into the live application before visual approval.


# Complete Icon System Verification

Date: 2026-07-19

## Automated contract

Run:

```sh
node source/build-icons.mjs
node source/verify-icons.mjs
```

Expected inventory:

- P0: 48
- P1: 46
- P2: 29
- Total: 123

The verifier checks filename-to-manifest parity, unique names, the 24 × 24
viewBox, 1.75 px base stroke, `currentColor`, XML-safe source structure, and
the absence of embedded hex/RGB colors in individual icon artwork.

## Visual contract

The three phase boards are generated from the individual SVG sources. Every
glyph appears at 14, 16, 20, and 24 px on both midnight and warm-light
surfaces. The faint 32 px rounded square behind each group represents the
likely minimum production control target; it is a specimen guide only.

| Board | Glyphs | Render size | Result |
| --- | ---: | ---: | --- |
| `proof/p0-contact-sheet.png` | 48 | 1600 × 2588 | Pass |
| `proof/p1-contact-sheet.png` | 46 | 1600 × 2588 | Pass |
| `proof/p2-contact-sheet.png` | 29 | 1600 × 1912 | Pass after semantic-color correction |

Visual inspection confirmed that each silhouette remains present at 14 px,
accents do not replace the primary shape, dense cards remain inside the 32 px
guide, and paired operations remain directionally distinguishable.

System `status-ready` uses semantic success green, `status-danger` uses semantic
danger red, and `status-warning` uses attention amber. These states do not
borrow cyan merely to look branded.

## Approval boundary

This package is a complete artwork candidate. It does not replace existing UI
symbols, add React components, or alter application behavior. Artwork approval
must happen before integration and interaction testing.

# Chai Studio Complete Icon System v1

Status: complete isolated artwork candidate — not integrated into the app.

This package expands the approved twelve-icon style proof into the complete
123-glyph Chai Studio production inventory.

## Inventory

| Phase | Scope | Glyphs |
| --- | --- | ---: |
| P0 | Workspace, shell, transport, timeline editing | 48 |
| P1 | Media, animation, audio, transcript and captions | 46 |
| P2 | Review, capture, delivery, QA, and system truth | 29 |
| **Total** |  | **123** |

## Package

- `svg/` — production-candidate individual SVG sources
- `manifest.json` — canonical icon names, categories, phases, and accents
- `contact-sheet.html` — data-driven phase renderer
- `proof/` — rendered P0, P1, and P2 dark/light multi-size boards
- `source/build-icons.mjs` — authored vector definitions and deterministic build
- `source/verify-icons.mjs` — structural contract checks
- `QA.md` — verification result and approval boundary

## Vector contract

- 24 × 24 master grid
- 1.75 px round stroke
- primary artwork uses `currentColor`
- one optional `--chai-icon-accent` with a `currentColor` fallback
- success and danger states use distinct semantic accents rather than brand color
- primary UI sizes: 14, 16, 20, and 24 px
- no embedded background
- no production component or application integration in this package

The approved twelve proof icons are carried forward unchanged. The remaining
111 glyphs use the same grid, optical weight, corner language, and restrained
accent logic.

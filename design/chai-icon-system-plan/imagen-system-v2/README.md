# Chai Studio Imagen Icon System v2

Status: complete Imagen source-generation candidate — not integrated.

The earlier generated icon directions are rejected. This folder contains the
new Imagen-led system generated in controlled sheets of 11–12 icons.

## Deliverables

- `sheets/chroma/` — eleven Imagen source sheets on removable backgrounds
- `sheets/transparent/` — eleven RGBA sheets after matte and despill
- `icons/transparent-384/` — 123 individually split, normalized RGBA icons
- `proof/all-sheets-overview.png` — consolidated dark-surface review image
- `proof/ui-size/` — exact browser renders at 14, 16, 20, and 24 CSS px
- `proof/CHECKSUMS.sha256` — reviewed proof and policy hashes
- `icons/light-384/` — deterministic ink variants for warm-light surfaces
- `size-policy.json` — approved minimum-size and tooltip contract
- `sheet-manifest.json` — canonical sheet order and icon-name mapping
- `scripts/split-all-sheets.py` — deterministic sheet splitter
- `scripts/verify-assets.py` — size, alpha, corner, count and coverage checks
- `PROMPTS.md` — built-in ImageGen prompt grammar and Sheet 01 full prompt
- `QA.md` — current verification result and remaining production boundary

Sheet 01 contains the twelve visual-language anchors:

1. workspace-edit
2. workspace-media
3. workspace-animation
4. capture-exact
5. render
6. play
7. blade-tool
8. snap
9. keyframe
10. waveform
11. qa-scan
12. status-warning

The visible black behind the transparent preview is supplied by the viewer.
It is not baked into the RGBA asset.

## Workflow boundary

All 123 source icons are generated, transparent, and normalized. They are not
integrated production UI assets. Exact browser proofing approves the complete
family at 16–24 px and a named micro-safe subset at 14 px. Animation, final
locking, and application integration remain separate gates.

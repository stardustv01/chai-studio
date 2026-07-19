# Imagen System v2 Verification

Date: 2026-07-19

## Current result

- 11 Imagen-generated sheets
- 123 canonical icon names
- 123 individually split transparent PNGs
- 384 × 384 normalized source canvas with a 304 px optical maximum
- RGBA alpha channel retained
- transparent corners verified
- plausible visible-pixel coverage verified
- no application integration
- dark and warm-light variants rendered at exact 14, 16, 20, and 24 CSS px

## Generation method

The built-in ImageGen tool generated each sheet using two references:

1. the locked Chai Studio logo contact sheet for brand DNA;
2. approved Sheet 01 for icon weight, geometry, spacing, and accent consistency.

Each generated sheet used a flat `#00ff00` extraction background. The installed
chroma-key helper produced RGBA output using soft matte and despill. The fixed
4 × 3 sheet geometry then produced deterministic individual files.

## Visual inspection

All sheets were inspected during generation. Directional pairs, editing tools,
media types, curve modes, audio controls, caption/review actions, capture
variants, delivery actions, and status meanings were checked for ordering and
obvious semantic drift. Dense spot checks confirmed clean isolation for
`linked-clips`, `metadata`, `speaker-filter`, `capture-before-effects`, and
`status-conflict`.

## Remaining gates

### Exact-size verdict

- **20 px and 24 px:** all 123 icons pass visual review.
- **16 px:** all 123 icons pass when paired with the required label or tooltip.
- **14 px:** only the 38 icons listed in `size-policy.json` pass. Dense media,
  inspector, caption, capture, and delivery symbols require at least 16 px.
- **Control target:** the icon may be smaller, but its action target remains at
  least 32 × 32 px.

The first proof failed because normalized assets retained excessive grid-cell
padding. The splitter was corrected to trim alpha bounds and fit glyphs to a
304 px optical maximum within each 384 px source canvas. All three browser
proofs were rerendered after this correction.

### Remaining gates

Before integration:

- animate only the approved micro-animation subset;
- lock checksums;
- integrate through a separate candidate and test real control geometry,
  contrast, tooltips, keyboard access, and supported viewports.

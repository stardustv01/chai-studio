# Imagen System v2 Prompts

## Sheet 01 — Core 12

Mode: built-in ImageGen with the locked Chai logo contact sheet as a brand
reference. The logo image is not an edit target.

```text
Use case: stylized-concept
Asset type: transparent-source production icon sheet 01 for Chai Studio
Reference image role: Image 1 is the locked Chai Studio brand reference. Use only its visual DNA: warm ivory forms, a precise cyan vertical playhead, restrained amber gesture, editorial timeline rhythm, and calm midnight-era sophistication. Do not copy or redraw the logo letters.
Primary request: Create exactly 12 original professional video-editing UI icons as a coherent premium family, arranged in a strict 4-column by 3-row grid, with no labels. This is a completely new icon direction; do not imitate generic stock outline libraries or the previous icon concepts.
Required icon order, left to right:
Row 1: workspace-edit (timeline workspace with tracks and playhead); workspace-media (curated media frames/library); workspace-animation (Bezier motion curve and keys); capture-exact (precision capture frame and target).
Row 2: render (timeline becoming a finished output); play (transport play); blade-tool (professional razor edit tool); snap (magnetic timeline snapping).
Row 3: keyframe (diamond time key); waveform (audio waveform); qa-scan (inspection scan with verified result); status-warning (clear attention warning).
Style/medium: distinctive flat vector-like emblem icons, bold and highly authored. Strong filled silhouettes plus controlled negative-space cuts, gently softened corners, optical balance, and one recurring Chai signature: a narrow cyan playhead/spine or tiny cyan precision node where semantically relevant. Amber appears only as a small warm gesture or warning accent. Avoid generic monoline construction. No 3D bevel, no gloss, no shadows.
Background: perfectly flat uniform solid #00ff00 chroma-key background for removal. No tile cards, no dark panels, no frames around individual cells, no texture, no gradient, no lighting variation.
Composition: 4 equal columns by 3 equal rows; exactly one centered icon in each invisible cell; equal visual scale; generous separation; no overlaps; no missing or repeated icons.
Color palette: opaque #F5EFE2 warm ivory primary, #19D9EA cyan precision accent, #F2B33F amber warmth/attention. Use #070A12 only as rare opaque internal detail where absolutely necessary; prefer chroma background showing through as negative space. Never use #00ff00 inside a glyph.
Production constraints: crisp opaque edges; readable silhouette when reduced; minimal internal detail; consistent weight; no cast shadow, contact shadow, glow, reflection, letters, words, numbers, captions, watermark, logos, device mockup, or decorative border.
Avoid: generic outline icons, emoji, childish rounded app icons, clay 3D, glassmorphism, photorealism, inconsistent perspective, random colors, excessive detail, duplicate symbols, dark tile backgrounds.
```

The generated chroma sheet was converted to RGBA using the installed
`remove_chroma_key.py` helper with soft matte and despill.

## Sheets 02–11 shared prompt grammar

Every later sheet used built-in ImageGen with the same two references: the
locked Chai logo as brand DNA and Sheet 01 as the exact icon-family anchor.
Each request specified the ordered icon names from `sheet-manifest.json`, a
strict 4 × 3 grid, one intentionally empty final cell for eleven-icon sheets,
and a complete grid for twelve-icon sheets.

```text
Match Sheet 01's flat premium ivory emblem construction, cyan precision
playhead, restrained amber warmth, controlled negative space, optical weight,
scale, and spacing. Create only the ordered new semantic symbols. Use a
perfectly uniform #00ff00 removal background with no tiles, cards, borders,
gradients, texture, glow, vignette, reflection, or shadow. Keep crisp opaque
edges. Use no words, letters, numbers, labels, logos, watermark, duplicates,
or extra symbols. Never use #00ff00 inside a glyph.
```

Semantic constraints were supplied per sheet for mirrored transport pairs,
clipboard actions, media types, curve modes, audio routing, captions, capture
variants, delivery states, and system truth. The exact ordered mapping is the
canonical `sheet-manifest.json` file.

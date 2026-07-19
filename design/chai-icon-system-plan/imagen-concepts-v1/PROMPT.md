# Imagen Prompt — Master Direction Board v1

Mode: built-in ImageGen

Reference image role: locked Chai Studio logo contact sheet used only for
palette and emotional character. The generated board is new artwork, not an
edit or tracing.

```text
Use case: stylized-concept
Asset type: master visual-direction board for a premium professional video-editing application's UI icon system
Primary request: Design a cohesive family of 24 original interface icons inspired by the supplied Chai Studio brand reference. This is a new concept board, not an edit or tracing of the reference.
Reference image role: brand palette and emotional character only — midnight background, warm ivory forms, precise cyan playhead, restrained amber gesture.
Subject: exactly 24 separate symbolic UI icons arranged in a precise 6-column by 4-row grid. The symbols should cover workspace editing, media, animation curves, exact capture, render/export, play, razor edit, snapping magnet, keyframes, audio waveform, captions, search, timeline marker, color/graphics, review comment, eye/visibility, QA scan, approval, delivery, folder, microphone, layers/composition, warning, and system ready.
Style/medium: premium vector-like icon design with bold sculpted silhouettes, controlled negative space, gently softened geometry, subtle optical depth, and small inset enamel accents. More authored and distinctive than generic monoline icons, but still clean enough to translate into 16–24 px production UI assets. Consistent visual grammar across the entire family.
Composition/framing: one centered square presentation board; 24 equal dark tiles; one icon centered per tile; generous consistent padding; no captions.
Lighting/mood: restrained soft studio depth, sophisticated and calm, not glossy toy icons.
Color palette: #070A12 midnight, #F5EFE2 warm ivory, #19D9EA cyan used only for precision/active state, #F2B33F amber used only for creative warmth/attention.
Materials/textures: mostly clean flat vector surfaces with extremely subtle bevel or inset depth; crisp edges.
Constraints: exact 6 by 4 icon grid; clear unique silhouette in every tile; one coherent family; no repeated symbols; no logo redraw; no Devanagari letters; no English words; no numbers; no labels; no watermark; no mockup device; no gradients inside the primary ivory glyphs; avoid thin fragile strokes.
Avoid: generic stock outline icon library, emoji, neon cyberpunk, excessive 3D, glassmorphism, photorealism, random colors, decorative flourishes, illegible micro-detail.
```

## Transparent-source edit

Mode: built-in ImageGen edit, followed by the installed chroma-key removal
helper using soft matte and despill.

```text
Use case: background-extraction
Asset type: transparent-source atlas for UI icon production
Input image: Image 1 is the edit target and contains 24 approved icon concepts in a 6-column by 4-row arrangement.
Primary request: Preserve the identity, silhouette, ivory/cyan/amber colors, internal geometry, order, and exact 6-by-4 arrangement of all 24 icons. Remove every midnight tile, dark background, bevel shadow, cast shadow, contact shadow, glow, and reflection. Place only the 24 icon glyphs on a perfectly flat solid #00ff00 chroma-key background for background removal.
Composition: exactly 24 separate icons, six columns and four rows, each centered in an equal invisible cell with generous consistent separation and padding. No tile outlines and no card shapes.
Style: retain the clean sculpted vector-like forms, but make edges crisp and opaque so each icon can become a transparent PNG.
Constraints: change only the background and remove shadows; keep every icon recognizable and separate; background must be one uniform #00ff00 with no gradients, texture, lighting variation, floor plane, or vignette; do not use #00ff00 anywhere inside any icon; no text, labels, numbers, watermark, border, mockup, tile, or frame around the whole atlas.
Avoid: dark background remnants, green spill, semi-transparent shadows, overlapping icons, new symbols, missing symbols, rearranged rows.
```

# Chai Studio — Warm Timeline identity candidate

This folder is an isolated production sandbox for the Chai Studio logo system.
Nothing in it has been copied into or wired into the live application.

## What is ready for review

- Six deterministic, outlined SVG masters for the wordmark, compact symbol,
  app icon, bilingual lockup, and monochrome uses.
- A 2.4-second HyperFrames/GSAP motion proof. The usable UI sting completes in
  620 ms; the remaining time is a still hold for inspection.
- Reduced-motion behavior that presents the final lockup immediately.
- Review boards, exact-time snapshots, and a focused amber-pulse keyframe strip.
- Frozen local font sources and their SIL Open Font License.

The exact Hindi signature is `चाय`. The full wordmark uses Noto Sans Devanagari
Regular for breathing room; the compact `च` symbol uses SemiBold so it survives
16–48 px UI sizes. All shipping masters contain outlines, not live text.

## Creative logic

- The Devanagari headline doubles as an editing timeline.
- The cyan playhead communicates precision and studio control.
- The asymmetric amber inner curve carries warmth, freshness, and creative
  energy without becoming a teacup, leaf, flame, or literal steam mark.
- Three.js is intentionally absent: deterministic SVG and one paused GSAP
  timeline express this identity more faithfully and with less UI overhead.

## Review these first

1. `proof/masters-review.png` — master system, app scale, monochrome, palette.
2. `snapshots/contact-sheet.jpg` — the complete 0–2.4 s reveal progression.
3. `proof/amber-pulse-keyframes.png` — focused 0.30–0.62 s pulse movement.
4. `ASSET_MANIFEST.md` — intended use of every deliverable.

## Local preview and verification

From this folder:

```sh
npm run dev
```

The composition is 1920×1080 at 60 fps. Its root source is `index.html`; the
HyperFrames-discoverable copy is `compositions/index.html`.

Verification completed against HyperFrames 0.7.63:

- lint: 0 errors, 0 warnings
- runtime: 0 errors, 0 warnings
- layout: 0 errors, 0 warnings
- motion: 0 errors, 0 warnings
- contrast: 0 errors, 0 warnings
- checked at 0, 0.18, 0.36, 0.62, 2.39, and the exact 2.40 s boundary

No MP4 has been rendered and no project-root integration has been performed.
Those remain approval-gated steps.

## Status

**Production candidate — awaiting visual approval.** After approval, copy only
the selected masters and the agreed runtime treatment into the live project;
do not move this whole sandbox into the application.


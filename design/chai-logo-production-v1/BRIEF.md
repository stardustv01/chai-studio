---
workflow: motion-graphics
flow: automation
storyboard: no
message: "Chai is warmth and freshness living inside a precise professional editing system"
destination: chai-studio-ui-and-app-launch
aspect: 1920x1080
language: en-hi
length: 2.4s-proof-with-620ms-ui-sting
audience: chai-studio-users
angle: logo-reveal
---

## Intent

Create the production candidate for Chai Studio's “Warm Timeline” identity. The
Devanagari word `चाय` is the emotional signature: its headline behaves like an
editing timeline, a restrained cyan playhead represents precision, and an amber
inner pulse represents warmth, freshness, and creative thought. The result must
feel intimate and intelligent without becoming decorative or cute.

## Assets

- `../brand-concepts-v4/03-balanced-hybrid.png` — approved conceptual direction.
- `../brand-concepts-v4/04-motion-strip.png` — approved three-beat motion logic.

## Customizations

- Produce deterministic SVG masters for the primary bilingual lockup, compact
  UI symbol, and monochrome variant.
- Use Noto Sans Devanagari Regular for the full signature and SemiBold for the
  16–48px compact symbol. This is optical sizing of one identity, not two marks.
- Produce a seek-safe 2.4-second HyperFrames proof: the actual UI sting lasts
  approximately 620ms, followed by a still hold for inspection.
- Use SVG path/stroke motion and one paused GSAP timeline. Use Three.js only if
  flat vector motion cannot communicate the intended warmth; do not add 3D as
  decoration.
- Provide an instant final-state reduced-motion variant.

## Notes

- Work only in this isolated folder. Do not modify or copy files into the live
  Chai Studio application until explicit approval.
- The Hindi must remain exactly `चाय` and must be checked as rendered geometry,
  not trusted from ImageGen lettering.
- No teacup, leaf, literal steam, flame, generic Latin C, play-button logo,
  camera, film reel, clapperboard, glow spectacle, bounce, or perpetual loop.
- Deep midnight ink, warm tea amber, fresh cyan; muted violet only when needed
  for supporting UI, never in the core mark.

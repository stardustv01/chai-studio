# Asset manifest

## Shipping candidates

| File | Intended use | Geometry |
| --- | --- | --- |
| `masters/chai-bilingual-lockup.svg` | Marketing lockup, splash, onboarding, about surface | Regular `चाय` + outlined English companion |
| `masters/chai-wordmark-color.svg` | Primary wide Chai signature | Regular `चाय`, ivory/amber/cyan |
| `masters/chai-wordmark-mono.svg` | One-color print, light surfaces, masks | Regular `चाय`, currentColor-compatible visual |
| `masters/chai-symbol-color.svg` | Toolbar, sidebar, compact product UI | SemiBold `च`, optically sized for 16–48 px |
| `masters/chai-symbol-mono.svg` | Compact one-color UI | SemiBold `च`, monochrome |
| `masters/chai-app-icon.svg` | App tile and launch icon candidate | SemiBold `च` in a 512×512 midnight tile |

All six files are self-contained SVGs with outlined lettering. They do not
depend on an installed font or use generated-image lettering.

## Motion source

| File | Purpose |
| --- | --- |
| `index.html` | Canonical 2.4 s GSAP/HyperFrames proof |
| `index.motion.json` | Motion assertions for the canonical proof |
| `compositions/index.html` | HyperFrames composition copy |
| `compositions/index.motion.json` | Composition-local motion assertions |
| `shot-plan.json` | Approved timing, palette, and choreography contract |

The meaningful animation ends at 0.62 s and then holds. It does not loop. One
paused timeline is registered for deterministic seeking. `prefers-reduced-motion`
receives the completed logo immediately.

## Proof and audit artifacts

| File | Purpose |
| --- | --- |
| `proof/masters-review.png` | Full identity review board |
| `proof/weight-review.png` | Regular/Medium/SemiBold optical comparison |
| `proof/amber-pulse-keyframes.png` | Focused pulse motion strip |
| `snapshots/contact-sheet.jpg` | Animation progression at review beats |
| `snapshots/frame-05-at-2.4s.png` | Exact end-boundary frame |

Files named `*-source.svg`, scripts, local fonts, and references are production
sources or audit material—not assets to ship in the application bundle.

## Palette

| Token | Value | Meaning |
| --- | --- | --- |
| Midnight | `#070A12` | professional editing environment |
| Ivory | `#F5EFE2` | human warmth and legibility |
| Tea amber | `#F2B33F` | freshness and inner energy |
| Fresh cyan | `#19D9EA` | playhead precision |

## Typography provenance

The frozen Devanagari source is Noto Sans Devanagari v2.006 under the SIL Open
Font License. The license is stored at `assets/fonts/OFL.txt`. Regular is the
primary signature geometry; SemiBold is used only for compact optical sizing.

## Restrictions

- Preserve the exact spelling `चाय`.
- Do not replace the outlined masters with AI-generated lettering.
- Do not add a teacup, leaf, literal steam, flame, generic Latin C, play button,
  camera, film reel, clapperboard, glow spectacle, bounce, or perpetual loop.
- Do not move assets into the live project until the candidate is approved.


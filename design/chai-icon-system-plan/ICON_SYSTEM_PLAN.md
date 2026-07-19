# Chai Studio Icon System Plan

Status: planning only — no production icons created or integrated.

## Locked brand source

The icon system must derive its brand cues from the frozen logo pack at:

`design/chai-logo-production-v2-faithful/locked/approved-logo-animation-v1`

The app icon, symbol, wordmark, and lockups are already approved. They must be
reused, not redrawn.

## What the UI audit found

Chai Studio currently has no external or internal icon library. The UI uses
text, letters, and Unicode marks for many visual controls, including transport,
timeline tools, panel controls, state overlays, capture, review, and delivery.

The audit covered these live source surfaces:

- `apps/studio-web/src/App.tsx`
- `apps/studio-web/src/program-monitor.tsx`
- `apps/studio-web/src/timeline-editor.tsx`
- `apps/studio-web/src/professional-edit-bar.tsx`
- `apps/studio-web/src/source-inspection-monitor.tsx`
- `apps/studio-web/src/workspace-content.tsx`
- `apps/studio-web/src/keyframe-editor.tsx`
- `apps/studio-web/src/audio-mixer-panel.tsx`
- `apps/studio-web/src/transcript-caption-panel.tsx`
- `apps/studio-web/src/review-workspace.tsx`
- `apps/studio-web/src/delivery-workspace.tsx`
- `apps/studio-web/src/inspector-panel.tsx`
- `packages/ui-components/src/index.tsx`

## Creative direction

The system should feel like **editorial precision with human warmth**.

- Utility icons are crisp, quiet, and monochrome.
- Workspace and production-authority icons may borrow the approved timeline,
  playhead, and warm gesture as subtle structural motifs.
- Cyan is reserved for active playhead, exact capture, selection, and verified
  precision states.
- Amber is reserved for creative warmth, attention, and authored-media cues.
- Ivory is the primary icon color on dark UI surfaces.
- Semantic success, warning, and danger colors remain distinct from brand color.

Production icons must be hand-authored SVG. Imagen may be used only for a mood
or concept board; generated raster art is not suitable for 14–20 px UI controls.

## Drawing contract

| Property | Contract |
| --- | --- |
| Grid | 24 × 24 master grid |
| Live sizes | 14, 16, 20, and 24 px |
| Stroke | 1.75 px optical target, round caps and joins |
| Corners | Controlled 1.5–2 px visual radius |
| Color | `currentColor`; semantic or duotone accents only when specified |
| Fill | Used for selected, recording, warning, and status emphasis only |
| Alignment | Pixel-reviewed at every live size, not merely mathematically centered |
| Touch target | Icon controls remain at least 32 × 32 px where layout permits |
| Accessibility | Visible label or tooltip remains; icons never carry meaning alone |
| Motion | 140–220 ms; continuous loops only for genuinely active processes |
| Reduced motion | Every animated icon has a meaningful static state |

States are CSS/component states, not separate SVG files: default, hover,
pressed/selected, disabled, destructive, and busy.

## Production inventory

### P0 — Daily editing core: 48 glyphs

These should be created first because they are visible in nearly every editing
session.

**Workspace navigation — 5**

`workspace-edit`, `workspace-inspect`, `workspace-media`,
`workspace-animation`, `workspace-deliver`

**Global shell and utilities — 10**

`search`, `project-open`, `project-new`, `save-state`, `capture-exact`,
`render`, `command-palette`, `diagnostics-truth`, `panel-collapse-expand`,
`fullscreen`

**Program/source transport — 12**

`seek-start`, `seek-end`, `previous-frame`, `next-frame`, `play`, `pause`,
`loop-range`, `mark-in`, `mark-out`, `shuttle-backward`, `shuttle-forward`,
`playback-rate`

**Timeline and editing — 21**

`select-tool`, `blade-tool`, `split-playhead`, `snap`, `linked-clips`, `undo`,
`redo`, `nudge-left`, `nudge-right`, `add-track`, `delete`, `duplicate`, `copy`,
`paste`, `track-lock`, `track-mute`, `track-solo`, `keyframe`, `transition`,
`timeline-marker`, `compound-clip`

### P1 — Production panels: 46 glyphs

**Media and source — 14**

`folder`, `footage`, `interview`, `product-media`, `audio-media`, `graphic`,
`composition`, `import-media`, `relink`, `generate-proxy`, `validate-source`,
`media-offline`, `duplicate-hash`, `metadata`

**Animation and keyframes — 12**

`animated-property`, `key-add`, `key-remove`, `previous-key`, `next-key`,
`curve-editor`, `graph-value`, `graph-speed`, `tangent-mode`,
`interpolation-hold`, `interpolation-bezier`, `distribute-time`

**Audio — 10**

`waveform`, `gain`, `pan`, `fade-in`, `fade-out`, `crossfade`, `sync-anchor`,
`ducking`, `channel-map`, `loudness`

**Transcript and captions — 10**

`transcript`, `captions`, `speaker-filter`, `confidence-filter`, `corrected`,
`compare-script`, `caption-alignment`, `caption-position`, `safe-area`,
`word-highlight`

### P2 — Review, delivery, and system truth: 29 glyphs

**Review and capture — 10**

`review-bundle`, `feedback-request`, `review-issue`, `annotation`,
`visibility`, `capture-isolated`, `capture-before-effects`, `capture-alpha`,
`capture-ab`, `contact-sheet`

**Delivery and QA — 11**

`delivery-profile`, `render-range`, `render-frame`, `render-timeline`,
`named-version`, `render-queue`, `receipt`, `preflight`, `qa-scan`, `approve`,
`deliver-output`

**System truth — 8**

`status-ready`, `status-working`, `status-info`, `status-warning`,
`status-danger`, `status-offline`, `status-read-only`, `status-conflict`

Total: **123 unique base glyphs**. Shared actions such as open, reveal, compare,
retry, copy, duplicate, lock, visibility, and close reuse the same base glyph
across panels instead of creating near-duplicates.

## Micro-animation subset

Static SVGs are approved first. Only these eight icons receive optional motion:

1. `status-working` — restrained progress rotation.
2. `status-reconnecting` — two-stage reconnect sweep.
3. `capture-exact` — quick shutter/playhead flash.
4. `render` — timeline-to-output transfer.
5. `generate-proxy` — source-to-proxy compression.
6. `qa-scan` — single deterministic inspection sweep.
7. `status-ready` — short confirmation draw.
8. `status-warning` — one attention pulse, never an infinite alarm.

All motion must stop in a readable final state and respect reduced-motion
preferences.

## Production sequence

### Gate 1 — Style proof

Create twelve representative SVGs before the full set:

`workspace-edit`, `workspace-media`, `workspace-animation`, `capture-exact`,
`render`, `play`, `blade-tool`, `snap`, `keyframe`, `waveform`, `qa-scan`,
`status-warning`.

Review them together at 14, 16, 20, and 24 px on dark and light test surfaces.
This gate decides stroke weight, corner language, visual density, and how much
of the Chai timeline/playhead motif is allowed.

### Gate 2 — P0 set

Complete the 48 daily-editing icons, then replace only the current Unicode
controls in a separate UI candidate. Run target-size, contrast, keyboard,
tooltip, and layout tests before approval.

### Gate 3 — P1 set

Complete media, animation, audio, and caption icons. Test dense inspectors and
the 1180 × 720 minimum supported editor viewport.

### Gate 4 — P2 set and motion

Complete review, capture, delivery, QA, and system-truth icons. Add the eight
approved micro-animations only after their static forms pass.

### Gate 5 — Final lock and integration

Freeze SVG sources, generated React components, visual sheets, and checksums.
Only then replace the live UI glyphs. Integration is a separate approval from
icon artwork approval.

## Proposed implementation shape

When artwork is approved, add:

- `packages/ui-components/src/icons/Icon.tsx`
- `packages/ui-components/src/icons/icon-names.ts`
- `packages/ui-components/src/icons/svg/*.svg`
- `packages/ui-components/src/icons/index.ts`
- an icon-size and state specimen page;
- SVG linting for viewBox, hard-coded colors, stroke consistency, and empty
  accessible names;
- visual snapshots at 14, 16, 20, and 24 px;
- UI tests proving the existing accessible labels and minimum action targets
  remain intact.

No third-party icon dependency is required unless the style-proof round shows
that a custom 123-glyph set is unjustified. The current recommendation is a
custom Chai set because the application presently has no icon dependency and
its editing, capture, truth, and QA semantics are unusually specific.


# Chai Studio User Review Feedback

Review date: 2026-07-16  
Review status: Feedback collection only. Do not change implementation until the user explicitly confirms.

## Feedback 1 — “preview-baked” warning is unclear

### User question

> Why is it saying preview blocked?

### Attached image

![Feedback 1 — Validation and render impact showing preview-baked](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-add55ecf-6b96-4331-bcd9-3197097c1a0f.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-add55ecf-6b96-4331-bcd9-3197097c1a0f.png`

### Finding

The displayed text is `preview-baked`, not `preview blocked`.

This is not evidence that preview playback is blocked. It is a hard-coded warning attached to the demo **Data sequence** clip (`clip-studio-data-sequence`) in `packages/timeline/src/fixture.ts`. The inspector reads the clip's `metadata.warning` value and therefore changes the validation badge to `warning` and displays the raw warning text.

In this context, `preview-baked` appears intended to mean that the selected HyperFrames sequence is represented by a baked or pre-rendered preview rather than a fully interactive/native live preview.

### UX issue

The raw internal token `preview-baked` is ambiguous and looks like an error or blocked state. The interface does not explain:

- whether playback is actually available;
- why a baked preview is being used;
- whether final render quality is affected; or
- what the user should do next.

### Proposed follow-up — not implemented

After user confirmation, replace the internal token with a human-readable message such as:

> **Baked preview in use.** Playback is available using a pre-rendered proxy. Final rendering is not blocked.

The badge should distinguish an informational preview mode from a real validation warning or blocked state.

### Current decision

Recorded only. No application code, UI, fixture, or behavior has been changed.

## Feedback 2 — Play, J, and L do not move the timeline playhead

### User question

> Why is the timeline not moving when I click Play or use J/L?

### Attached image

![Feedback 2 — Transport shows playing while the timeline remains at frame 917](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-f687ba6b-cb99-402a-ad52-dcf91d861ab1.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-f687ba6b-cb99-402a-ad52-dcf91d861ab1.png`

### Finding

The transport command is being accepted, but the playback clock is not advancing.

Evidence visible in the screenshot:

- the top status pill says **Contract mock · Interactive · Proxy**;
- the central Play button has changed to the Pause icon, which means the UI state is `playing`; and
- the monitor and timeline remain at master frame `917`.

The review URL was served without an injected `window.__CHAI_STUDIO_SESSION__` token, so the frontend selected `contract-mock` mode. In that mode, `applyContractMockPreviewCommand()` changes the transport state to `playing` and J/L change the play rate or direction, but no timer, scheduler, or animation loop increments `preview.masterFrame`. The timeline playhead is derived from that unchanged master-frame value, so it remains stationary.

### Functional issue

This is not expected editor behavior. The controls visually claim that playback has started even though:

- the playhead does not move;
- the timecode does not advance;
- J/L shuttle does not traverse the timeline; and
- the preview image does not progress through frames.

The result is a false playing state rather than functioning playback.

### Related launch/session issue

The frontend and backend processes are running, but the browser session is not authenticated or connected to the server-owned preview scheduler. The current review launch therefore exposes the static contract mock instead of a live Studio session.

### Proposed follow-up — not implemented

After user confirmation:

1. make the launcher securely inject the local server origin and per-launch session token into the frontend;
2. ensure Play, Pause, J, K, and L operate the server-owned preview scheduler;
3. subscribe the UI to advancing preview-state events so the monitor, timecode, and timeline use the same master frame; and
4. prevent the UI from displaying `playing` when no advancing playback clock exists, including in contract-mock mode.

### Current decision

Recorded only. No transport, launcher, authentication, preview, timeline, or UI implementation has been changed.

## Feedback 3 — Clips cannot be dragged above or below onto another track

### User question

> Why is a clip on the timeline not able to move above or below onto other tracks?

### Attached image

![Feedback 3 — Selected FutureTitle clip cannot be moved from V2 to the empty V3 track](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-1661f61d-fefb-47d5-bcf1-b94455b0008d.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-1661f61d-fefb-47d5-bcf1-b94455b0008d.png`

### Finding

Vertical clip movement is not implemented in the timeline UI.

The current drag state stores only:

- the dragged clip;
- the original horizontal pointer position (`originX`); and
- the horizontal frame displacement (`deltaFrames`).

During pointer movement, the editor reads only `event.clientX`. It does not read the vertical pointer position, hit-test track rows, or record a destination track. When the pointer is released, the `clips.move` command always uses `drag.clip.trackId`, which is the clip's original track.

Therefore, dragging can change a clip's horizontal frame position but cannot change its vertical track assignment. The empty V3 track visible above the selected V2 clip does not change this behavior.

### Important distinction

The underlying timeline command engine already supports exact moves across writable tracks and has unit tests for that behavior. The missing capability is specifically the timeline editor's pointer interaction and visual drop-target handling.

This is not caused by:

- a locked V2 or V3 track;
- an overlap on the empty V3 track;
- Remotion or HyperFrames ownership; or
- incorrect dragging by the user.

### Functional issue

A professional timeline must allow compatible clips to move vertically between tracks while preserving exact frame placement. The current UI presents a Select/Move tool but implements only horizontal movement, which makes the interaction incomplete and misleading.

### Proposed follow-up — not implemented

After user confirmation:

1. extend drag state to track horizontal and vertical pointer displacement plus the candidate destination track;
2. hit-test visible track lanes and validate track type, lock state, collisions, and linked-clip rules during dragging;
3. display a clear valid or invalid drop-target preview;
4. submit `clips.move` with the selected destination `trackId` while preserving the exact start frame; and
5. add interaction tests for moving clips upward, downward, onto locked/incompatible tracks, and across a vertically scrolled timeline.

### Current decision

Recorded only. No drag behavior, timeline command, track validation, visual feedback, or application code has been changed.

## Feedback 4 — Selecting media does not select its clip on the timeline

### User question

> Why, when I select media, is it not automatically selected on the tracks?

### Attached image

![Feedback 4 — interview_nav.mov has focus in the Media panel but its timeline clip is not selected](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-23c32738-7990-4b5c-acaa-7e1d7140777c.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-23c32738-7990-4b5c-acaa-7e1d7140777c.png`

### Finding

The Media panel is currently static presentation UI and is not connected to timeline selection.

Each displayed `AssetRow` has only a label, metadata string, type, and optional hard-coded `active` flag. It has:

- no stable asset ID;
- no click handler;
- no media-selection state update;
- no lookup from an asset to its timeline clip instances; and
- no `selection.set` command sent to the timeline.

`FutureTitle_v04` is permanently rendered with `active` styling in the component source. Clicking `interview_nav.mov` gives the HTML button keyboard focus, producing the bright outline visible in the screenshot, but that focus is not application selection. The timeline therefore keeps its previous selected clip.

### UX issue

The interface visually conflates three different states:

- keyboard focus on the clicked media row;
- the hard-coded active media row; and
- the actual timeline clip selection.

This makes the click appear partially successful while the expected linked timeline selection does not occur.

### Functional issue

Media assets and timeline clips already have an asset-to-clip relationship in the timeline model, but the Media panel does not use it. There is no implemented reveal or select-in-timeline workflow.

For assets used more than once, the product also needs a deterministic selection rule—for example, select every matching clip instance, or select the nearest matching instance and provide navigation between occurrences.

### Proposed follow-up — not implemented

After user confirmation:

1. render Media rows from real asset records with stable asset IDs instead of static labels;
2. store media selection in the shared Studio snapshot rather than using a hard-coded active flag;
3. map the selected asset ID to its timeline clip instance or instances;
4. dispatch a real timeline `selection.set` command and reveal the matching track region;
5. visually distinguish focus, media selection, and timeline selection; and
6. add tests for unused assets, one occurrence, multiple occurrences, hidden tracks, and filtered timeline results.

### Current decision

Recorded only. No Media panel, asset model, selection state, timeline reveal behavior, or application code has been changed.

## Feedback 5 — Blade cuts at the playhead or midpoint instead of the clicked frame

### User observation

> Blade is not working properly. While Blade is on, clicking clips divides them into two halves, so it is not precise. Check how other editing systems handle blade functionality.

### Attached image

![Feedback 5 — Repeated Blade clicks divide Interview A into midpoint-sized pieces rather than cutting at the pointer](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-cca7d04a-ecf3-4ec2-ad8a-200b059c5a87.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-cca7d04a-ecf3-4ec2-ad8a-200b059c5a87.png`

### Finding

The Blade interaction does not calculate a cut frame from the pointer's horizontal position.

When a clip is clicked in Blade mode, the current implementation chooses:

1. the global master playhead frame, if that frame is strictly inside the clicked clip; otherwise
2. the mathematical midpoint of the clicked clip.

It never uses `event.clientX`, the clicked clip's bounding rectangle, timeline scroll position, or pixels-per-frame scale to determine where the user clicked.

In the screenshot, the master playhead is at frame `917`, while the repeatedly divided **Interview A** pieces are much earlier on the timeline. Because frame 917 is outside those pieces, every click takes the midpoint fallback. Repeated clicks therefore keep halving the clicked piece, which matches the observed result.

### Comparison with established editing systems

- [Adobe Premiere Pro — Cut clips](https://helpx.adobe.com/nz/premiere/desktop/edit-projects/trim-clips/cut-clips.html): select the Razor tool and click the point on the clip where the split is wanted. Modifier behavior controls whether only one part of linked audio/video is cut.
- [Apple Final Cut Pro — Cut clips in two](https://support.apple.com/en-ae/guide/final-cut-pro/ver4e30479/mac): the Blade tool cuts at the frame under the skimmer when clicked. Blade at the playhead, Blade All, and cutting multiple selected clips are distinct commands.
- [Blackmagic Design — DaVinci Resolve Editors Guide](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Editors-Guide.pdf): Blade Edit mode is enabled with B, and the user clicks the intended edit locations; linked-selection state determines corresponding audio/video cuts.

The shared professional pattern is that the pointer or skimmer position is the authority for a Blade-tool click. A playhead-based cut is a separate explicit command. None of these workflows silently substitutes the middle of a clip.

### Functional and UX issue

The current behavior makes frame-accurate cutting impossible with the Blade pointer and violates the visible interaction promise:

- the pointer location has no effect on the cut;
- no blade preview line identifies the prospective frame;
- there is no frame/timecode tooltip before committing;
- the midpoint fallback is undisclosed;
- playhead-based and pointer-based cutting are conflated; and
- linked audio/video cut behavior is not communicated at the point of action.

### Proposed Blade interaction contract — not implemented

After user confirmation:

1. calculate the exact master frame under the Blade pointer using the timeline lane bounds, horizontal scroll position, and current pixels-per-frame scale;
2. display a blade cursor plus a vertical preview line and frame/timecode tooltip before clicking;
3. cut the clicked clip exactly at that pointer-derived integer frame;
4. reject boundary clicks clearly instead of silently choosing another frame;
5. keep a separate keyboard/menu command for **Split selected clips at playhead**;
6. define linked-selection and modifier behavior for synchronized video/audio cuts;
7. support Blade All as a separate explicit action rather than an implicit side effect; and
8. test exact cuts at different zoom levels, horizontal scroll positions, fractional display scales, linked clips, clip boundaries, and vertically stacked tracks.

### Current decision

Recorded and researched only. No Blade behavior, pointer mapping, split command, linked-media policy, timeline UI, or application code has been changed.

## Feedback 6 — No clear way to target a frame, clip, time range, or duration for a requested change

### User question

> How are we going to select which frame, timeline clip, or duration needs to be changed?

### Attached image

![Feedback 6 — Codex context shows a master frame and selected IDs but no explicit target scope or duration](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-46a940f2-e8f8-4948-99f7-3aa1b5676430.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-46a940f2-e8f8-4948-99f7-3aa1b5676430.png`

### Finding

The current Inspect/Codex context UI does not provide an explicit target-scope selection workflow.

The visible selection manifest contains:

- one `masterFrame` (`917` in the screenshot);
- one corresponding timecode (`00:00:30;17`);
- selected entity IDs; and
- preview mode/state information.

It does not show or encode:

- whether the requested change applies to only the current frame;
- the timeline start and end of each selected clip;
- whether the full selected clip or clips are in scope;
- an active I/O or custom frame range;
- start and end timecodes;
- the selected duration in frames and seconds; or
- source-frame mappings for the requested range.

### Current behavior and limitations

- Moving the playhead can identify a single current frame.
- Selecting timeline clips can populate selected IDs.
- Timeline I/O commands exist elsewhere, but that range is not included in the visible copied context shown here.
- The review contact sheet automatically displays six frames around the current frame (`-12`, `-8`, `-4`, current, `+4`, `+8`).
- Those contact-sheet frame cards have no click handler, so they cannot currently select or seek to a frame.
- Creating a review bundle defaults its range to a single frame at the playhead rather than letting the user choose an exact duration here.

Therefore, this screen cannot unambiguously communicate whether a change should affect frame 917 only, both selected clips, a portion of either clip, or a longer timeline duration.

### Functional and authority issue

An editing request must bind **what** is selected to **when** it is selected. Entity-only or frame-only context is insufficient for precise changes and creates a risk that Codex edits too much or too little.

The current UI also uses the phrase **Copy exact context**, but the copied manifest does not contain an explicit change scope. That claim is stronger than the evidence provided.

### Proposed target-scope model — not implemented

After user confirmation, add a clear **Change scope** control with mutually understandable modes:

1. **Current frame** — exactly one master frame and timecode.
2. **Selected clip(s)** — the complete timeline ranges of all selected clips.
3. **Marked I/O range** — explicit inclusive start and exclusive end, with duration.
4. **Custom range** — user-entered or timeline-dragged start/end using frames or timecode.
5. **Entire sequence** — explicit full-timeline authority, never inferred.

The selected scope should be visibly highlighted on the timeline and represented in the context manifest with:

- `scopeKind`;
- selected clip/entity IDs;
- `startFrame` and `endFrameExclusive`;
- start and end timecodes;
- `durationFrames` and duration timecode;
- current/master frame;
- relevant source-frame ranges per clip; and
- revision and timeline identities.

### Proposed interaction details — not implemented

- Clicking a contact-sheet frame should seek/select that exact frame.
- Shift-clicking two contact-sheet frames could define a bounded review range.
- Timeline range dragging and I/O marks should update the same shared scope state.
- Choosing **Selected clip(s)** should show each clip's range and the combined affected span before context is copied.
- The UI should display a plain-language confirmation such as: **Change 2 selected clips from 00:00:30;17 to 00:00:34;05 — 102 frames.**
- Codex actions should refuse ambiguous mutation requests until an explicit scope is present.

### Current decision

Recorded only. No context manifest, range selection, contact-sheet navigation, I/O behavior, Codex bridge, review bundle, or application code has been changed.

## Feedback 7 — Animation workflow is unclear and not connected end to end

### User question

> How do animations work?

### Attached image

![Feedback 7 — Animation workspace shows zero opacity keys and blocks adding a key at frame 620](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-037b578d-2c8b-4eae-a3d4-2d1b58cb607b.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-037b578d-2c8b-4eae-a3d4-2d1b58cb607b.png`

### Intended keyframe workflow

The intended model is:

1. select a timeline clip;
2. choose a keyframeable property such as opacity, position, scale, or an engine-supported property;
3. place the master playhead inside that selected clip's timeline range;
4. set the property's value and add a keyframe at that exact master frame;
5. move to another frame inside the same clip and add a different value;
6. choose interpolation such as hold, linear, ease, or Bezier; and
7. evaluate the property between keys in the preview and final render.

Keyframes are stored using exact integer master frames and belong to one specific clip and property. A keyframe is not allowed before the owning clip starts or at/after its exclusive end frame.

### Why `+ Key` is blocked in the screenshot

The Inspector reports the selected owner's affected range as frames `239–430`, while the monitor and curve editor are at frame `620`.

Pressing `+ Key` attempts to create an opacity keyframe for the first selected timeline clip at the current master frame, 620. Timeline validation correctly rejects it because frame 620 is outside that clip's owner range. This produces the message:

> Keyframe frame is outside its timeline or clip owner range.

### UI and functional problems

Although the validator is protecting data integrity, the Animation workspace does not provide a coherent workflow:

- the selected keyframe owner and its valid frame range are not prominently identified;
- the current frame can remain outside the selected clip when entering Animation;
- `+ Key` remains enabled even when the current frame is invalid;
- the left **Animated property** list is static and has no selection handlers;
- **Bridge intensity** appears selected on the left while the Curve editor actually shows **Opacity**;
- the curve property dropdown is derived from automation lanes, not from the visible left-side property choice;
- the curve graph displays keys but does not support dragging keys in time or value;
- adding a key uses the property's current base value without a clear per-key value control;
- the monitor artwork is a static contract-mock/proxy presentation and is not visibly evaluating the edited keyframe curve; and
- Play is already affected by the non-advancing contract-mock playback issue, so animation cannot be reviewed over time.

Therefore, the underlying keyframe data model exists, but the current Animation workspace is not a complete usable animation system.

### Proposed animation workflow — not implemented

After user confirmation:

1. show the selected clip name, engine, and exact valid range at the top of the Animation workspace;
2. automatically reveal or seek into the selected clip when Animation opens, without silently changing selection;
3. connect the left property list, Inspector property, curve dropdown, and automation lane to one shared selected-property state;
4. disable `+ Key` outside the owner range and provide a direct **Go to clip** action;
5. allow a user to set a value, add/toggle a key, and see the key immediately on both the timeline and curve graph;
6. support precise key dragging, numeric frame/value entry, snapping, multi-selection, copy/paste, and tangent editing;
7. evaluate the same keyframe curve in interactive preview and final rendering;
8. clearly distinguish shared Chai animation from Remotion-native and HyperFrames-native animation ownership;
9. preserve or explicitly convert native animation rather than overwriting it implicitly; and
10. verify animation playback, scrubbing, reopening, splitting, trimming, and rendering with parity tests.

### Plain-language interaction example

For an opacity fade on a clip spanning frames 239–430:

1. select that clip;
2. choose **Opacity**;
3. seek to frame 239, set opacity to 0%, and add a key;
4. seek to frame 269, set opacity to 100%, and add a second key; and
5. choose **Ease out** and play or scrub to review the fade.

The UI should prevent keys outside frames 239–429 and explain that frame 430 is the exclusive clip boundary.

### Current decision

Recorded only. No animation selection, keyframe behavior, curve editing, preview evaluation, native ownership, validation, or application code has been changed.

## Feedback 8 — “Review overlays are excluded” is unclear, and exact capture never completes

### User question

> Why is it saying review excluded? I think you should guide me on how I need to test or check.

### Attached image

![Feedback 8 — Exact fidelity frame toast says review overlays are excluded and capture remains pending](/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-3c13d1ad-1d1d-4b5e-9696-5feaf21886c9.png)

Original attachment path:
`/var/folders/yk/p0jj1_6j697ggwfkrmzmrx300000gn/T/codex-clipboard-3c13d1ad-1d1d-4b5e-9696-5feaf21886c9.png`

### Meaning of the message

The toast says **Review overlays are excluded**, not that the review itself is excluded.

Review overlays are visual aids placed over the composition for inspection, such as:

- safe-area and guide lines;
- selection or bounding outlines;
- annotation markers;
- comparison dividers or wipe controls;
- diagnostic labels; and
- other review-only UI graphics that should normally not be burned into a clean captured frame.

The capture control defaults `includeOverlays` to `false`. Its dropdown contains an **Include review overlays** toggle. This default is reasonable for clean fidelity evidence, but the toast wording is too easy to misunderstand.

### Current functional issue

The current `requestCapture()` implementation only creates a local notification and performance measurement. It does not call a capture API, enqueue a backend capture job, receive a completion event, or present an output file/manifest.

Therefore, the text **Capture remains pending until server confirmation** describes a confirmation path that this UI does not currently initiate. In the present review build, the request remains a visual mock and cannot complete.

This is especially misleading because the screen is already in **Contract mock** mode, where no authenticated server-owned capture session is connected.

### Expected capture behavior — not implemented

After user confirmation:

1. clicking **Capture exact** should create a real authenticated capture job bound to revision, timeline, frame, preview/fidelity mode, and overlay choice;
2. the UI should show queued, rendering, completed, failed, or cancelled state;
3. completion should produce a visible thumbnail plus a revision-bound capture manifest and checksum;
4. a clean capture should clearly say **Clean frame — overlays excluded**;
5. an overlay capture should clearly say **Review evidence — overlays included**;
6. failures should provide a concrete reason and retry action; and
7. contract-mock mode should say **Preview only — capture unavailable** instead of claiming a pending server request.

### Current decision

Recorded only. No capture control, overlay policy, backend request, job state, notification, or application code has been changed.

## Guided manual review checklist

Use this checklist while the application remains frozen. Report each unexpected result with a screenshot; it will be added to this file without changing the implementation until explicit confirmation.

### Important review-state warning

The top status currently says **Contract mock · Interactive · Proxy**. This means the screen is useful for reviewing layout and discovering interaction gaps, but it is not evidence that server-backed playback, capture, persistence, rendering, or exact-fidelity workflows work.

Do not treat a changed button, toast, or badge as success unless the underlying frame, data, output, or receipt also changes.

### Test 1 — Selection synchronization

1. Open **Edit**.
2. Click one timeline clip.
3. Confirm only that clip is visibly selected.
4. Check whether the Inspector shows that same clip and its exact range.
5. Click a media item used by that clip.
6. Check whether the matching timeline occurrence becomes selected and revealed.

Record: selected media, expected clip, actual clip, and screenshot.

### Test 2 — Transport and frame authority

1. Note the current frame and timecode.
2. Click Play and wait two seconds.
3. Confirm the frame, timecode, playhead, and preview all advance together.
4. Test J, K, and L.
5. Test previous/next frame and ±1 second.

Pass condition: every surface shows the same advancing or sought master frame. A Pause icon alone is not a pass.

### Test 3 — Timeline movement

1. Select an unlocked clip.
2. Drag it horizontally to a known frame.
3. Drag it vertically to an empty compatible track.
4. Try a locked or incompatible track.
5. Undo and redo each valid move.

Pass condition: valid moves commit exactly; invalid moves show a reason before drop; undo/redo restores the exact prior state.

### Test 4 — Blade precision

1. Turn Snap off.
2. Enable Blade.
3. Click a visibly chosen point that is not the clip midpoint and not the playhead.
4. Compare the resulting cut frame with the clicked frame.
5. Repeat at another zoom level and after horizontal scrolling.

Pass condition: the cut occurs at the pointer-derived frame. It must never silently use the midpoint.

### Test 5 — Inspector edits

1. Select one clip and note its valid range.
2. Change one shared property such as scale or opacity.
3. Confirm the preview and affected-render range update.
4. Undo and redo.
5. For an engine-owned property, do not press **Convert to shared** unless intentionally testing a destructive authority conversion.

Pass condition: editable shared properties update safely; engine-owned animation remains preserved until explicit conversion.

### Test 6 — Animation

1. Select a clip and note its start/end frames.
2. Enter **Animation** and verify the same owner is shown.
3. Choose one property.
4. Seek inside the clip range and add two keys with different values.
5. Scrub and play through them.
6. Try adding a key outside the clip range.

Pass condition: valid keys appear on the curve and affect preview/render; invalid keys are prevented before submission with a clear **Go to clip** action.

### Test 7 — Change scope and Codex context

1. Select a single frame, then copy context.
2. Select one clip, then copy context.
3. Mark an I/O range, then copy context.
4. Compare each manifest.

Pass condition: every manifest explicitly states its scope kind, entities, start/end frames, timecodes, and duration. If these are absent, the context is ambiguous.

### Test 8 — Capture

1. Open the arrow beside **Capture exact**.
2. First leave **Include review overlays** off and request a clean capture.
3. Then enable it and request review evidence.
4. Look for a real job ID, progress state, output thumbnail/file, manifest, and completion receipt.

Current expected finding: both actions only create a toast and do not complete. This test should be repeated after capture wiring is implemented and the app is running in an authenticated server session.

### Test 9 — Save, reopen, and persistence

1. Make one reversible edit.
2. Confirm an actual saved revision is created.
3. Reload or reopen the project.
4. Verify selection-independent project data, keyframes, ranges, and timeline positions persist exactly.

Pass condition: reopened state matches the saved revision. A static **Saved** label is not sufficient evidence.

### Test 10 — Render and delivery

1. Choose a delivery profile.
2. Run preflight.
3. Start a short bounded render.
4. Inspect progress, cancellation, QA results, output identity, and receipt.

Pass condition: a real output and authoritative receipt exist. A notification or mock progress state is not sufficient.

### Recommended review order

Complete Tests 1–4 first. They establish selection, time, movement, and cutting—the basic editing authority needed before Animation, Codex context, Capture, and Render can be reviewed meaningfully.

## Live Chrome validation run — 2026-07-16

### Run conditions

- Tested the already-open Chrome tab at `http://127.0.0.1:4173/` through the installed GPT/Codex browser extension.
- The application reported **Contract mock · Interactive · Proxy** for the entire run. Results below validate the contract-preview frontend only; they do not validate authenticated server playback, persistence, capture, render, or delivery.
- The tab initially rendered at approximately `1280×720`. The lower timeline panel had a measured height of `0` even though its controls remained mounted in the DOM and the toggle was labelled **Collapse lower panel**. A temporary `1600×1000` test viewport still required manually toggling the panel before it expanded to about `285 px`. This is a state/label and small-viewport usability issue.
- The viewport, clipboard, and application state were restored at the end. The tab was reloaded and left open. No application source code was changed.
- Chrome reported no console warnings or errors during the run.

### Result summary

| Review item                             | Result              | Live observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview-baked` warning                 | Confirmed           | Selecting **Data sequence** changed the Inspector badge to **Warning** and displayed the raw paragraph `preview-baked`. No playback-blocked explanation or next action was shown.                                                                                                                                                                                                                                                                                                                       |
| Test 1 — Selection synchronization      | Partial / fail      | Clicking **Interview A** selected exactly that timeline clip and changed the Inspector to **Interview A**, range `48–430`. In Media, clicking `product_macro_02.mov` only moved keyboard focus; metadata remained `interview_nav.mov`, and returning to Edit left **Interview A** selected.                                                                                                                                                                                                             |
| Test 2 — Transport and frame authority  | Fail                | Play changed the control to **Pause**, but after 2.2 seconds the timecode, master frame, monitor identity, preview, and playhead all remained at frame `444`. J and L behaved the same. K returned the visual state to paused. Previous/next frame and ±1 second did seek correctly and kept the visible timecode, frame, and monitor identity synchronized.                                                                                                                                            |
| Test 3 — Timeline movement              | Partial / fail      | Horizontal drag moved **FutureTitle_v04** exactly from `430–760` to `330–660`; Undo restored `430–760`, Redo restored `330–660`, and a final Undo restored the original range. Dragging the same clip vertically from V2 toward the valid empty portion of V3 did nothing: it stayed on V2 and produced no valid/invalid drop feedback.                                                                                                                                                                 |
| Test 4 — Blade precision                | Fail                | With Snap off and the Blade tool active, a click at roughly the 25% point of **Interview A** corresponded to about frame `144`. The master playhead was outside the clip at frame `444`. The result was two equal clips, `48–239` and `239–430`, proving the cut used the midpoint `239`, not the pointer frame. The split was undone and Select/Snap were restored.                                                                                                                                    |
| Test 5 — Inspector edits                | Fail                | Opacity accepted `100 → 90` and created an **Undo Update clip property** command, but the program-monitor capture was byte-for-byte unchanged. Undo and Redo both left the field at `90`; reselecting the clip still showed `90`. **Reset Opacity** was required to restore `100`.                                                                                                                                                                                                                      |
| Test 6 — Animation                      | Partial / fail      | At frame `444`, outside the selected clip range `48–430`, **+ Key** remained enabled and failed only after submission with the range-validation message. There was no **Go to clip** action. Inside the range, keys at `384` and `414` were created and appeared in the curve. The isolated artwork/copy region was byte-for-byte identical at the two keyframes despite opacity values `80` and `100`, and Play remained frozen at frame `384`. Both keys were removed and opacity was reset to `100`. |
| Test 7 — Change scope and Codex context | Fail                | **Copy exact context** produced only `projectId`, `revisionId`, `masterFrame`, `timecode`, `selectedIds`, and preview mode/state. After marking In at `414` and Out at `444`, the copied schema still contained no `scopeKind`, range, clip bounds, start/end timecodes, or duration. Returning to Edit showed **No I/O range**, so the mark commands did not persist as a usable range in this build.                                                                                                  |
| Test 8 — Capture                        | Fail / mock only    | Clean and overlay-enabled exact-capture requests produced only pending toasts. Neither request produced a job ID, progress state, thumbnail, output file, manifest, checksum, failure reason, or completion receipt. The overlay toggle wording changed correctly between excluded and explicitly included, then was restored to excluded.                                                                                                                                                              |
| Test 9 — Save, reopen, persistence      | Fail                | Changing opacity to `95` left both the header and footer at **Revision 428** and **Revision 428 · Saved**; the event control remained `Event — · 0 ms`. Reloading reset the project to its default selection and opacity `100`, so no saved revision or persisted edit was demonstrated.                                                                                                                                                                                                                |
| Test 10 — Render and delivery           | Blocked / mock only | Selecting the **Review proxy** profile updated the local profile summary to `1280×720` with proxies allowed. **Run timeline preflight** left the existing static **Sample checks passed** presentation unchanged. **Render frame** was rejected with **Contract preview is read-only. Launch the authenticated macOS app to create or control renders.** No current job or output was created.                                                                                                          |

### Additional observations from the live run

1. The Media workspace contains a deeper synchronization defect than timeline reveal alone: clicking a different row changes browser focus but does not even update the visible **Asset metadata** record.
2. Inspector Undo/Redo is currently a false control for the tested opacity edit. The command labels and history buttons changed, but the property value and preview did not follow the history state.
3. The Animation workspace still shows a disconnected property story: the left panel presents **Bridge intensity**, while the curve editor operates on **Opacity** for the selected **Interview A** clip.
4. The full program-monitor image changed between frames because frame identity/timecode changed, but the isolated artwork/copy region did not change between the two opacity keyframes. This supports the existing finding that the contract-mock artwork is not visibly evaluating the edited curve.
5. The Deliver workspace explicitly labels the queue as a **Sample projection**. Its displayed active job remains at `73%`; controls are read-only. The visible sample output is `renders/sample/launch-film-r427.mp4` from revision `427`, while the active project and queue source revision are `428`. It must not be treated as output from this test.
6. The **Receipt** control did not reveal a new current receipt. The visible receipt block remained sample data and delivery stayed locked.

### Run decision

Feedback collection and live reproduction are complete. No implementation, fixture, transport, timeline, animation, capture, persistence, render, or delivery behavior was changed. The application should remain frozen until the user explicitly approves implementation work.

## Implemented remediation run — 2026-07-16

The user subsequently approved implementation of all recorded feedback, beginning with the authenticated launcher. The original findings above remain unchanged as the historical pre-implementation record. The implementation state is now as follows.

### Authenticated local launcher

- `chai-studio launch` creates or opens a real local `.chai` project, starts the server and web UI, and injects the per-launch session into `window.__CHAI_STUDIO_SESSION__` before React starts.
- The token is defined as an immutable page bootstrap value. It is not placed in the URL or printed in launcher output.
- The server permits only the exact loopback Studio origin selected for that launch. Nearby or unlisted origins are rejected.
- The browser receives no persistent user-profile path. Playwright validation uses only its managed Chromium and headless-shell binaries; installed Google Chrome is not selected.

### Recorded feedback resolution

| Recorded item                                | Implemented resolution                                                                                                                                                                                                                                                                                                                                  | Automated evidence                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feedback 1 — raw `preview-baked` warning     | Replaced the raw warning with an informational explanation that a baked interactive proxy is available and final rendering is not blocked.                                                                                                                                                                                                              | Authenticated UI workflow and Inspector projection checks pass.                                                                                        |
| Feedback 2 — Play/J/L frozen                 | Added an authoritative rational playback clock, server preview ticks, reverse/end/loop handling, and live event projection. Rapid monitor commands are serialized against fresh server state versions.                                                                                                                                                  | The authenticated workflow confirms that the master frame advances after Play; preview unit and server integration tests pass.                         |
| Feedback 3 — no vertical track movement      | Added vertical track hit-testing, type/lock/collision preflight, valid/invalid lane feedback, and destination-track commits.                                                                                                                                                                                                                            | The authenticated workflow moves `Interview A` from V1 to a collision-free V2 range and verifies authoritative Undo.                                   |
| Feedback 4 — Media selection disconnected    | Media rows are derived from the real timeline. Selecting an asset selects all timeline occurrences, chooses the nearest primary occurrence, and updates live metadata.                                                                                                                                                                                  | The authenticated workflow selects `product_macro_02.mov`, verifies its metadata, returns to Edit, and verifies `Product macro` is selected.           |
| Feedback 5 — Blade used midpoint             | Blade now converts pointer X through the timeline ruler into an exact integer master frame, shows the guide/timecode, and rejects clip boundaries.                                                                                                                                                                                                      | The authenticated workflow clicks approximately 25% into `Interview A`, verifies the non-midpoint split ranges, then verifies Undo.                    |
| Feedback 6 — ambiguous change scope          | Inspect now exposes current frame, selected clips, marked range, custom range, and entire sequence scopes. The manifest includes exact frames, timecodes, duration, clip/source ranges, and selected entities.                                                                                                                                          | The authenticated workflow chooses marked range and verifies `scopeKind` plus the exact three-frame duration.                                          |
| Feedback 7 — disconnected Animation workflow | The selected clip is the animation owner; entering Animation seeks inside its exclusive range; the left property list and curve property share state; `+ Key` is disabled outside the range; `Go to clip` is available; numeric values are accepted; and opacity curves are evaluated by the program artwork. Native/shared ownership remains explicit. | The authenticated workflow adds an opacity key at 80 and verifies one key plus evaluated program opacity `0.8`; keyframe and timeline unit tests pass. |
| Feedback 8 — capture stayed pending          | Clean and overlay capture modes now rasterize the actual program surface and submit an authenticated capture record. Completion reports the capture identity/output; Contract Mock truthfully reports capture as unavailable.                                                                                                                           | The authenticated workflow receives `Exact fidelity frame completed` and confirms one server-side capture record.                                      |

### Additional live-run defect resolution

- Inspector property edits now affect the program artwork, persist as revisions, survive reload, and participate in server-backed Undo/Redo. Duplicate blur submission after Enter is suppressed so history commands cannot race a second property commit.
- I/O marks are persisted as the authoritative timeline range. Preview and project mutations are serialized and refreshed from server authority to prevent stale-revision conflict overlays during rapid edits.
- The Media metadata panel now reflects the selected real asset instead of static fixture text.
- Stored layouts are migrated to layout version 2; invalid or zero-height lower panels recover to a visible usable height, and collapse/expand labels reflect the actual state.
- The Deliver workspace uses the live render queue and current project revision. Static sample projections, stale sample paths, and misleading sample receipt states are no longer presented as current output.
- The starter project contains valid timeline/audio authority and deterministic local asset descriptors, so authenticated edits no longer fall back to Revision 428 contract data.
- Local still rendering runs through a real FFmpeg executor and writes a receipt-backed PNG. Render and QA state comes from the authoritative queue rather than a notification-only mock.

### Verification evidence

- Authenticated recorded-feedback browser workflow: **1 passed**. It covers authentication, playback, capture, Inspector edit/Undo/Redo/reload, I/O persistence, Media synchronization, vertical movement, Blade precision, scope manifest, animation evaluation, and real local still rendering.
- Unit suite: **77 files, 317 tests passed**.
- Property suite: **10 files, 20 tests passed**.
- Non-browser integration suite: **42 files, 79 tests passed**.
- Native runtime integrations: **Remotion 1 passed; HyperFrames 1 passed**.
- Visual golden suite: **1 passed**.
- ESLint, both TypeScript builds, schema generation check, package boundaries, security scan, production web build, and browser-isolation validation pass.
- Browser-isolation evidence reports `systemGoogleChromeSelected: false` and `persistentUserProfileConfigured: false`.

### Updated decision

The recorded implementation defects are corrected and the automated implementation gate passes. The next step is owner review in the authenticated local Studio. Release signing remains outside this remediation and requires separate explicit approval.

## Authenticated owner-acceptance run — 2026-07-17

### Run conditions

- Tested the already-open authenticated Chrome Studio at `http://127.0.0.1:4173/` through the installed browser extension.
- Used the real project at `/Users/praveengupta/Desktop/studio2/Chai Studio Projects/Launch Film.chai`.
- Temporary opacity and animation-key edits were removed after verification. The exact capture, still render, and QA receipts were retained as test evidence.
- Vertical track drag and pointer-derived Blade precision were not manually repeated in this pass; they remain covered by the authenticated regression recorded above.
- Release approval, delivery recording, and signing were not attempted.
- Chrome reported no console warnings or errors during this run.

### Manual acceptance results

| Area                                     | Result                              | Authenticated observation                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server truth and transport               | Pass                                | Studio reported `Interactive · Proxy` and `Local · live`; no `Contract mock` or `Sample projection` was shown. Play advanced the authoritative frame, Pause settled, J moved backward, L moved forward, and K stopped the clock after the short server settlement interval.                                                                                                                                                                                             |
| Exact capture                            | Pass                                | Clean capture completed with ID `capture-942c4a32-7211-42fe-9501-42244da413e7`. The PNG and JSON record exist under `captures/`. The completion toast explicitly stated that review overlays were excluded.                                                                                                                                                                                                                                                             |
| Media/selection warning                  | Pass with observation               | Selecting `data_sequence.html` synchronized the asset, timeline occurrence, and Inspector. The warning was human-readable: `Baked preview in use. Playback is available through a pre-rendered proxy; final rendering is not blocked.` One direct timeline-selection attempt did not visibly commit, but the behavior was not reproduced consistently enough to classify as a defect.                                                                                   |
| Inspector edit, history, and persistence | Pass                                | Interview A opacity changed from `100` to `64`; the program artwork evaluated to `0.64`. Undo restored `100`, Redo restored `64`, and reload retained `64`. Opacity was restored to `100` after the test.                                                                                                                                                                                                                                                               |
| I/O and change scope                     | Pass / limited receipt inspection   | Mark In at frame `573`, Mark Out at frame `575`, and the marked-range scope selector all committed. The UI represented the expected inclusive three-frame range. The very large serialized context receipt was not independently field-parsed during this Chrome pass; exact `scopeKind` and duration remain covered by the authenticated regression.                                                                                                                   |
| Animation ownership and key management   | Pass / limited visual remeasurement | Entering Animation auto-seeked from frame `575` to the selected Interview A owner range at frame `48`. An opacity key with value `77` was created and then removed; the key count returned to zero and base opacity remained `100`. The evaluated program opacity was not independently remeasured in this manual pass; the automated authenticated regression covers that assertion.                                                                                   |
| Still rendering                          | Pass                                | The `Still frame` profile produced a real PNG at `renders/output-db692c3b-cdf0-4310-8ba7-f9d61e41eb84/frame-48.png`, output ID `output-db692c3b-cdf0-4310-8ba7-f9d61e41eb84`, job ID `job-f7d28281-a7ef-4b29-9494-b084697fc7dc`, SHA-256 prefix `255e16824351…`, and an immutable render receipt. The initial lifecycle state was correctly `rendered unchecked`; delivery remained locked.                                                                             |
| Output QA                                | **Fail — new defect**               | Running QA on the valid one-frame PNG changed the lifecycle to `qa failed`. `qa.post.structure` incorrectly required rational FPS, audio presence, sample rate, and channels even though the selected Still profile declares `fps: null`, `audioCodec: null`, and `audioSampleRate: null`. The executor also wrote `program-audio.wav` for the no-audio profile. The generated visual checklist used timeline-style frames `0–1799` instead of the rendered frame `48`. |

### New findings

#### A17-01 — Still-profile QA applies video/audio and timeline requirements

- Severity: **release-blocking for still delivery**.
- Reproduction: choose **Still frame**, render one frame, then run **Run output QA**.
- Actual result: QA fails with `Mismatched: rational FPS, audio presence, sample rate, channels.` A silent WAV is attached to a profile that explicitly requests no audio, and the review checklist targets frames `0`, `450`, `900`, `1350`, and `1799` rather than the single rendered frame `48`.
- Expected result: still QA validates the one PNG, its dimensions/hash/color/alpha, and a one-frame visual checklist. It must omit FPS/audio requirements and must not emit an audio artifact for a no-audio still profile.
- Evidence: `receipts/renders/output-db692c3b-cdf0-4310-8ba7-f9d61e41eb84/qa/2026-07-16T20-37-32-595Z-qa-report-d60327cd-917c-43bf-afa1-700df8ead862.json`.

#### A17-02 — Visible revision identity drifts across authenticated surfaces

- Severity: **high truth/provenance risk; repeat once during implementation diagnosis**.
- During the same authenticated session, the project header began at `Revision 428`, changed to `Revision 2` after asset selection, and later showed `Revision 10`, while the program-monitor identity continued to show `rev 428`. The immutable render receipt used source revision ID `revision-e83b6667-0a75-4cb4-aa12-aac2ba903eb6`.
- Expected result: human-readable revision labels and monitor/output provenance should resolve to one authoritative revision or clearly label different counters/identities so the user cannot mistake stale preview identity for the saved source revision.

### Acceptance decision

The authenticated editing, transport, capture, persistence, scope, animation-key, and real-render paths are materially improved and passed the manual checks above. Owner acceptance is **not release-ready** because A17-01 currently prevents a valid Still output from completing QA, and A17-02 leaves revision provenance ambiguous. Release signing remains unapproved.

## Authenticated owner-feedback remediation — 2026-07-17

The two defects found during the authenticated owner-acceptance run have been implemented and verified. The original findings above remain unchanged as the historical record.

### A17-01 — corrected

- No-audio delivery profiles now produce explicit `not-applicable` audio evidence instead of measured audio evidence.
- The local executor no longer creates or attaches `program-audio.wav` when the selected profile declares `audioCodec: null`.
- Still-frame QA no longer requires video FPS, audio presence, sample rate, or channel measurements. It validates the rendered image structure while retaining the profile's intentional `fps: null` and no-audio contract.
- A still render now receives exactly three visual-review checklist items for color, alpha, and the rendered image. Every item points to the actual rendered frame rather than timeline-wide sample frames.
- The focused local-render integration rendered frame `48`, produced a PNG without a WAV, passed output QA, reported audio as `not-applicable`, and generated three checklist items all targeting frame `48`.

### A17-02 — corrected

- The authenticated initial state no longer flashes the fixture `Revision 428` identity while the real project snapshot is loading.
- The header, footer, and Program Monitor now derive their human-readable label from the same authoritative project revision identity.
- The Program Monitor no longer contains hard-coded `rev 428` or synthetic environment provenance. It exposes the full revision ID and revision number used by the header so automated checks can detect drift.
- The authenticated workflow verifies the header and monitor identities after initial load, reload, and the render/QA lifecycle. Their revision IDs and revision numbers remain aligned.

### Verification evidence

- Authenticated recorded-feedback workflow: **1 passed**, including real still render, output QA pass, three frame-48 checklist items, no mismatch finding, and aligned revision provenance after QA.
- Broader non-browser integration suite: **42 files, 79 tests passed**.
- Focused server render API and local executor coverage confirms that existing audio/video delivery behavior remains measured while still/no-audio output is explicitly not applicable.
- Browser isolation passed before browser execution with `systemGoogleChromeSelected: false` and `persistentUserProfileConfigured: false`.

### Updated acceptance state

A17-01 and A17-02 are corrected in implementation and automated verification. A fresh owner review of the restarted authenticated Studio is the remaining acceptance step. Release approval, delivery recording, and signing remain untouched and require separate explicit approval.

## Comprehensive authenticated UI regression — 2026-07-17

### Run conditions and cleanup

- Tested the authenticated Studio at `http://127.0.0.1:4173/` in the user's existing Chrome session, including Edit, Media, Inspector, Inspect, Animation, Capture, and Deliver.
- Used the real project at `/Users/praveengupta/Desktop/studio2/Chai Studio Projects/Launch Film.chai`.
- Temporary clip movement, Blade split, deletion, added track, opacity edits, and animation keys were undone or removed. The final project contains 5 tracks, 8 clips, zero animation keys, and base clip opacity `100%`.
- Release approval, delivery recording, release signing, and permanent review records were not attempted.
- No browser-console warnings or errors were observed during the run.

### Functional results

| Area                                   | Result                            | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and project truth       | Pass                              | Studio reported `Interactive · Proxy` and `Local · live`; neither `Contract mock` nor `Sample projection` was shown. Header, Program Monitor, and footer aligned on authoritative Revision 46 / `revision-52c825c7-dcd5-4d93-a953-4c87fd5891a0`.                                                                                                                                                                                                                                |
| Program transport and keyboard control | Pass                              | Previous/next frame, +/-1 second, start/end, Play/Pause, J/K/L, Fit/Fill, loop, playback rate, and keyboard zoom all settled to the expected authoritative frames.                                                                                                                                                                                                                                                                                                              |
| Edit and timeline                      | Pass with reliability defect      | Vertical V1-to-V2 movement, invalid caption-lane rejection, Nudge, Undo/Redo, Snap, search, pointer-derived Blade, Delete, and Add Track worked. Duplicate/Copy/Paste correctly reported collision blockers. One tab's event stream changed to offline during normal use, after which enabled Delete/Add Track commands silently did nothing; opening a fresh authenticated tab restored them.                                                                                  |
| Panel layout and help                  | Pass with accessibility defect    | Left, right, and lower panels collapsed and restored; keyboard help opened and closed. Left/right collapse buttons retained `Collapse ... panel` labels while collapsed instead of changing to `Expand`.                                                                                                                                                                                                                                                                        |
| Media and source monitor               | Partial                           | Real media search and selection synchronized Media, timeline, and Inspector; metadata and the baked-preview explanation were correct. Source frame stepping did not move the master clock. Three-point insert repeatedly failed with a stale-revision conflict even immediately after reload. Source-frame capture failed because the program capture surface was unavailable. Source-type tabs exposed fixture content and reused one Stable ID across different source kinds. |
| Inspector                              | Pass                              | Opacity changed from 100 to 67, evaluated to `0.67` in the Program Monitor, participated in Undo/Redo, survived reload, and was restored to 100.                                                                                                                                                                                                                                                                                                                                |
| Inspect and change scope               | Pass / permanent records excluded | Current-frame, selected-clips, marked-range, custom, and entire-sequence manifests carried the expected exact ranges and durations. Refresh, exact-context clipboard copy, Wipe/Onion/Difference/Split modes, and split position passed. Review bundle/issue/feedback creation was not exercised because it would create permanent project records.                                                                                                                             |
| Animation                              | Pass                              | Workspace auto-seeked into the selected owner clip; out-of-range `+ Key` protection and `Go to clip` worked. Two opacity keys evaluated correctly at `0.8` and `0.2`; key navigation, curve modes, lower tabs, and graph zoom worked. Both keys were removed afterward.                                                                                                                                                                                                         |
| Capture                                | Pass with repeat-use defect       | Clean, overlays, current preview, isolated clip, before effects, alpha, A/B, review range, and contact-sheet modes all produced PNG/JSON records. After several consecutive captures, `Open capture modes` stopped opening until page reload; the failure reproduced twice.                                                                                                                                                                                                     |
| Deliver preflight and render           | Partial                           | Still profile selection, explicit timeline preflight, and real frame-78 rendering passed. New output `output-ff6500e7-6a78-4092-861f-935f5058ca5e` contains the PNG and no WAV, matching the corrected no-audio profile. Before explicit preflight, Deliver still displayed the misleading static text `Sample checks passed`.                                                                                                                                                  |
| Deliver QA and receipt                 | **Fail — release blocker**        | The new output card and latest receipt could not be selected. The active QA panel remained pinned to the older failed output, even after selecting the new job row, output card, and receipt through both normal pointer interaction and DOM-targeted clicks. Therefore the corrected Still output could not be run through QA or verified in the authenticated UI.                                                                                                             |

### New findings

#### UI17-01 — Event stream can go offline without recovery

- Severity: **high functional reliability risk**.
- During normal authenticated UI work, one tab changed from `Local · live` to `Event stream offline`. Enabled Delete and Add Track actions then silently did nothing.
- Browser refresh did not recover the stream. Opening a fresh authenticated Studio tab restored live state and both commands.
- Expected result: the client reconnects or clearly blocks server-dependent actions with a recovery path; enabled controls must not silently no-op.

#### UI17-02 — Three-point edit conflicts from a fresh live state

- Severity: **high editing blocker**.
- With Insert selected, `Apply three-point edit` repeatedly returned `Revision changed before your command`, including immediately after reload while the footer reported `Local · live`.
- `Retry and resync` did not complete the edit; `View workspace safely` only dismissed the conflict.

#### UI17-03 — Latest rendered output cannot be selected for QA

- Severity: **release-blocking**.
- The corrected Still output exists and has the expected PNG-only structure, but the Deliver output/receipt selection remains pinned to the older failed output.
- Expected result: selecting the newest output updates the QA panel and receipt context so that QA can run against that exact immutable output.

#### UI17-04 — Source-frame capture is unavailable in Media

- Severity: **medium**.
- `Capture source frame` returns `Capture failed — The program capture surface is unavailable.`

#### UI17-05 — Side-panel accessible labels do not reflect collapsed state

- Severity: **medium accessibility defect**.
- The left and right panel buttons continue to announce `Collapse ... panel` after their panels are collapsed. The same stale-labeled button restores the panel.

#### UI17-06 — Capture-mode menu becomes unresponsive after repeated captures

- Severity: **medium workflow reliability defect**.
- After several successful captures, the enabled `Open capture modes` button stops opening the menu. Reload restores it; the behavior reproduced twice.

#### UI17-07 — Source-type tabs still expose fixture identity

- Severity: **medium truth/provenance defect**.
- The source monitor tablist is labelled `Source type fixture`; Video, Image, Remotion, and HyperFrames show different names/kinds but reuse Stable ID `asset-interview-nav-0001` and the same source characteristics.

#### UI17-08 — Deliver displays sample preflight success before real preflight

- Severity: **medium truthfulness defect**.
- A freshly opened authenticated Deliver workspace displays `Sample checks passed` before `Run timeline preflight` is executed. Running the real preflight correctly changes the state to `Ready to render`.

### Final regression verdict

The core Edit, transport, Inspector, Inspect scope, Animation, capture generation, and PNG-only Still execution paths are working. The authenticated Studio is **not UI release-ready** because event-stream loss can silently disable edits, three-point editing is blocked by revision conflict, and the newest valid render cannot be selected for QA or receipt verification. Release approval, delivery recording, and signing remain unapproved.

## Comprehensive UI regression remediation — 2026-07-17

The eight defects recorded in the comprehensive authenticated UI regression have been implemented and verified. The findings above remain unchanged as the historical pre-remediation record.

### Release-blocking and high-risk corrections

#### UI17-01 — event-stream recovery and visible edit failure

- The SSE subscription no longer depends on the latest event ID. Previously every event caused React to abort and recreate the stream, eventually producing the observed offline state.
- The stream now keeps its resume cursor internally and remains mounted until actual shutdown.
- Every valid received event restores the explicit `Local · live` state and resets reconnection attempts.
- Full project resyncs are serialized so an older response cannot overwrite newer authoritative timeline or I/O state.
- If a server-backed timeline edit still fails after recovery, Studio now displays `Timeline edit not applied` with the server diagnostic instead of silently doing nothing.

#### UI17-02 — three-point editing

- Timeline mutations fetch the current authoritative project snapshot before validation and commit.
- A stale-revision response triggers one bounded resync, rebuilds the edit against the fresh timeline, and retries with a new command/idempotency identity.
- Source In/Out defaults are now constrained to the selected source's real available range instead of fixture-length marks that may exceed short clips.
- The authenticated regression committed a real Insert three-point edit, observed the new revision and inserted clip, then undid it successfully.

#### UI17-03 — exact Deliver output/QA selection

- Output cards are ordered newest first and expose exact accessible output identities.
- A newly completed output is selected automatically.
- Selecting an output immediately clears stale receipt/QA projection, cancels any request for the prior output, and accepts evidence only when the returned `outputId` matches the current selection.
- Every Deliver mutation now fetches the current authoritative revision immediately before preflight, render, QA, approval, or delivery.
- The authenticated regression rendered two PNG-only Still outputs, switched receipt/QA context from the newest output to the prior output and back by exact output ID, and kept the event stream live.

### Additional defect corrections

- **UI17-04:** Media source artwork is now an explicit capture surface. `Capture source frame` produced an authenticated PNG/JSON capture in the regression.
- **UI17-05:** collapsed left and right panels now announce `Expand left panel` and `Expand right panel`, with matching arrow direction.
- **UI17-06:** notification containers no longer intercept clicks intended for the Program Monitor. Five repeated capture-menu cycles passed after the fix.
- **UI17-07:** the source tablist is now labelled `Source type`; each source kind has distinct identity, duration, rate, dimensions, proxy, and audio truth. When a matching timeline clip exists, its real asset ID, name, available range, and source rate are used.
- **UI17-08:** authenticated Deliver initializes with no preflight record. `Sample checks passed` remains limited to the unauthenticated contract preview and is never shown as real authenticated evidence.

### Verification evidence

- Authenticated end-to-end workflow: **1 passed**. It covers live event state, I/O persistence, source capture, three-point Insert plus Undo, two real Still renders, newest-output auto-selection, exact output/receipt switching, Still QA, and revision alignment.
- Program Monitor/UI regression: **6 passed**, including repeated capture-menu use, distinct source identities, and truthful collapsed-panel labels.
- Unit and property suites: **87 files, 337 tests passed**.
- Non-native integration suite: **42 files, 79 tests passed**.
- Browser isolation passed before every browser run with `systemGoogleChromeSelected: false` and no persistent user profile.

### Updated acceptance state

UI17-01 through UI17-08 are corrected in implementation and automated verification. A fresh owner review of the restarted authenticated Studio is the remaining UI acceptance step. Release approval, delivery recording, permanent review records, and signing remain untouched and require separate explicit approval.

## Owner UI remediation retest — 2026-07-17

### Run conditions

- Loaded the current implementation in a fresh tab inside the user's existing authenticated Chrome session and used the real `Launch Film.chai` project.
- Retested UI17-01 through UI17-08 first, followed by transport, Inspector history, Inspect scope, Animation evaluation, exact capture, and Deliver QA smoke coverage.
- Did not create review bundles/issues, approve output, record delivery, or sign a release.
- The Chrome console remained empty throughout the retest.

### Remediation results

| Finding                                 | Result                                  | Owner UI evidence                                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI17-01 — event reliability             | Pass                                    | Delete reduced the timeline from 8 to 7 clips and Undo restored 8. Add Track increased 5 tracks to 6 and Undo restored 5. The footer stayed `Local · live` through the complete run.                                                                                            |
| UI17-02 — three-point edit              | Pass                                    | Insert created a ninth timeline clip and `Undo Insert clip` restored 8 clips. No stale-revision conflict or `Timeline edit not applied` message appeared.                                                                                                                       |
| UI17-03 — Deliver selection and QA      | Pass                                    | Selecting the old failed output and corrected output switched the QA panel and exact Output ID both ways. Output `output-ff6500e7-6a78-4092-861f-935f5058ca5e` completed QA with `qa passed`, no structural mismatch, and three checklist items all targeting frame 78.         |
| UI17-04 — source capture                | Pass                                    | `Capture source frame` completed as capture `capture-b7598246-80b7-4b79-b8e2-2e1cbc2d3f20`; its PNG and JSON exist in the project.                                                                                                                                              |
| UI17-05 — panel labels and restoration  | **Partial — new functional regression** | Right-panel Collapse/Expand worked and labels changed truthfully. The collapsed left panel correctly announces `Expand left panel`, but clicking it through both semantic UI interaction and coordinate input does nothing. Dismissing notifications did not change the result. |
| UI17-06 — capture-menu repeat use       | Pass                                    | With capture notifications present, five consecutive open/close cycles each produced one visible Capture modes menu and closed back to zero.                                                                                                                                    |
| UI17-07 — source identity               | Pass                                    | The tablist is labelled `Source type`. Video, Image, Remotion, and HyperFrames exposed distinct IDs and kinds: `asset-clip-studio-interview-a`, `asset-hero-environment-0001`, `asset-clip-studio-future-title`, and `asset-clip-studio-particle-bridge`.                       |
| UI17-08 — authenticated preflight truth | Pass                                    | Deliver initially displayed `No preflight recorded`; `Sample checks passed` was absent. Running real preflight produced `Ready to render`.                                                                                                                                      |

### Cross-workspace regression

- Transport: playback advanced from frame 0 to frame 32 and paused authoritatively while the event stream stayed live.
- Inspector: Interview A opacity committed at 73 and server-backed Undo restored 100.
- Inspect: marked-range scope resolved exactly to 573–576, three frames, with `scopeKind: marked-range`.
- Animation: entering the workspace auto-seeked to frame 48; an 80% opacity key evaluated the Program artwork to `0.8`; removing it returned to zero keys and base opacity 100.
- Capture: exact fidelity capture completed as `capture-0279edf0-f9a3-4602-8bd8-e8a2c2898b1c` with PNG and JSON evidence.
- Project cleanup: final authoritative state is 5 tracks, 8 clips, zero animation keys, and Interview A opacity 100.

### UI17-09 — collapsed left panel cannot be expanded

- Severity: **high usability regression / owner-acceptance blocker**.
- Reproduction: collapse or load a layout with the left panel collapsed, then click `Expand left panel`.
- Actual result: the control remains labelled `Expand left panel`; the left-panel content does not return. The right-panel control works correctly.
- Expected result: the left panel becomes visible and the button changes to `Collapse left panel`.

### Retest verdict

The eight previously recorded defects are materially corrected, including the three release-blocking paths: event reliability, three-point Insert, and exact Deliver output QA. The corrected Still output now passes authenticated QA. Owner UI acceptance is still **not complete** because UI17-09 can permanently strand the left panel in a collapsed layout until the implementation is repaired. Approval, delivery, and signing remain unapproved.

## UI release-readiness remediation — 2026-07-17

This section records the implementation response to the owner acceptance report covering accessibility scaling, Animation layout, inactive controls, E2E contract drift, typography, hierarchy, and minimum-window behavior. The findings above remain as historical pre-remediation evidence.

### Corrections implemented

- **Single-pass accessibility scaling:** every explicit UI font size now multiplies the root `--accessibility-text-scale` exactly once. The recursive descendant `1em` rules were removed. Full-workspace 115% and 130% visual baselines now exist, and the 130% diagnostics height is bounded to the expected single-scale ratio.
- **Animation curve layout:** the curve toolbar is a responsive grid with labels above readable controls, a fixed-width multi-property selector, wrapping action rows, and a full-width zoom control. Pairwise collision checks pass at 1440×900 and the supported minimum 1180×720.
- **Functional or honest browser controls:** Edit asset search, Media footage search, Media project search, asset collections, folders, and smart collections now drive visible state. Media/Project/Transcript tabs switch state; unavailable Project/Transcript surfaces and add actions are explicitly described and disabled rather than pretending to work.
- **Behavior-contract reconciliation:** revision identity includes both revision number and stable short ID; Render opens the real Deliver setup; unauthenticated capture states remain explicitly unavailable; Blade is tested at the pointer frame rather than the playhead.
- **Readability and hit targets:** visible microtext now has an 11px floor, primary buttons use 12px text, important dense controls have at least 28px height, and tertiary contrast is stronger.
- **Hierarchy:** the monitor remains the dominant Edit/Animation surface while curve controls use ordered grid rows instead of one equally weighted scrolling strip.
- **Minimum window:** widths below 1180px show a blocking, semantic `Window too small` explanation with the exact 1180×720 requirement instead of silently clipping the inspector and global controls.
- **Deliver panel collision:** the QA/receipt title is measured to clear the right-panel collapse control.
- **UI17-09:** collapsed side panels now establish a foreground stacking context so their outboard expansion controls cannot be intercepted by the center stage. The regression now collapses and restores both panels and verifies their content returns.

### Verification added

- Six focused UI-acceptance scenarios cover filtering, both supported Animation sizes, the below-minimum gate, Deliver header clearance, and single-pass 130% scaling.
- Side-panel restoration is tested as a complete collapse/expand interaction rather than a label-only assertion.
- Reviewed goldens were inspected before regeneration, including Edit, Media, Animation, curve editor, Deliver, Inspect capture truth, and both accessibility scales.
- Browser isolation remained `systemGoogleChromeSelected: false` with no persistent profile configured. Installed Google Chrome was not launched.

### Current acceptance boundary

These remediations do not approve an output, create a delivery record, sign a release, or mutate the authenticated owner project. Final automated gate results are recorded after the clean validation run below.

### Final automated gate — passed

- Lint, formatting, package-boundary checks, TypeScript build contracts, schema generation, deterministic fixture verification, and security checks passed.
- Unit suite: **77 files, 317 tests passed**.
- Property suite: **10 files, 20 tests passed**.
- Standard integration suite: **42 files, 79 tests passed**.
- Real runtime integrations: **Remotion 1/1 passed** and **HyperFrames 1/1 passed** using Playwright-managed headless executables.
- Reviewed golden manifest: **1/1 passed**, with all six explicit checksums verified.
- Complete isolated Chromium E2E/visual suite: **49/49 passed**.
- Production web build passed. Vite reported a non-blocking 536.52 kB main-chunk advisory; future code splitting remains a performance improvement, not a current correctness failure.
- Browser isolation immediately before the final browser run reported `systemGoogleChromeSelected: false` and `persistentUserProfileConfigured: false`.

### Remediation verdict

The defects in this UI acceptance report and UI17-09 are corrected in implementation and automated regression coverage. The implementation is ready for a fresh owner UI review. This verdict does **not** authorize approval, delivery, release signing, or permanent review records.

## Owner UI gap remediation — 2026-07-17

This section records the implementation response to the subsequent 1440×900 owner review that found four gaps despite the prior 49/49 automated result.

### Corrections implemented

- **Animation and Inspector containment:** the keyframe curve lower panel now occupies only the available center column when the right Inspector is open. The rule is scoped to the curve editor, so Audio Mix and Bridge Editor retain their required full-width lower layouts.
- **Media folder and smart-collection filtering:** the selected browser folder is now owned by the shared workspace state and consumed by both the left project browser and `MediaCenter`. Folder predicates filter the real sequence asset grid, displayed counts come from those same predicates, text search composes with the selected folder, and zero-result collections show explicit empty states. Smart collections no longer advertise fixture counts or display unrelated normal assets when no authoritative collection metadata exists.
- **Scaled badge floor:** badges now use an 11px base font multiplied once by the accessibility text scale. At 130%, the tested computed badge size is at least 14.2px.
- **Actionable target floor:** monitor transport and capture actions use a 29px CSS safety bound so fractional layout rendering still produces an actual hit-tested width and height of at least 28px.

### Regression coverage added

- Media acceptance now proves that Product contains only the product asset and that Missing / offline produces a zero-count empty state.
- Animation acceptance now measures the curve lower panel against the external right Inspector boundary at both 1440×900 and 1180×720, in addition to checking pairwise curve-control collisions.
- Accessibility acceptance enumerates every visible badge at 130% and enforces the scaled minimum.
- Monitor acceptance measures every visible transport and capture control and enforces actual rendered 28×28px bounds.
- The existing authoritative Audio Mix interaction is part of the focused regression to prevent the curve containment rule from constraining other Animation tabs.

### Verification result

- Focused curve, Media, badge, hit-target, and Audio Mix scenarios: **9/9 passed**.
- Complete isolated Chromium E2E and visual suite: **51/51 passed** across clean shards, including all refreshed reviewed screenshots.
- Unit suite: **77 files, 317 tests passed**.
- Reviewed golden manifest: **1/1 passed**, with all six explicit checksums verified.
- Lint, formatting, package boundaries, TypeScript, schema generation, production build, and security checks passed.
- Browser isolation passed before every browser run with `systemGoogleChromeSelected: false` and no persistent user profile. Installed Google Chrome was not launched.

### Acceptance boundary

The four owner-review gaps are corrected in implementation and now have direct regression coverage that would fail the previous UI. The implementation is ready for a fresh authenticated owner review. No owner project, approval, delivery record, review record, or release signature was changed or created.

## P28/V1 release-blocker remediation — 2026-07-17

This section records the implementation response to the subsequent P28/V1 audit. The audit verdict remains historically valid: its cited candidate was not releasable. The corrections below establish a new engineering baseline; they do not retroactively approve that candidate.

### Production-path corrections

- **Authenticated launcher:** the per-launch local token is injected before React starts, sent only in the request header, restricted to the exact local Studio origin, and never placed in the URL or terminal output.
- **Authoritative pixels:** full-timeline shared, Remotion, and HyperFrames rendering now comes from immutable revision manifests. Exact capture and render no longer fall back to the interactive DOM or a synthetic slate.
- **Decoded QA:** QA probes the produced artifact, handles Still/no-audio outputs as not applicable, and evaluates the rendered frame range rather than the full timeline.
- **Source truth:** registered image/video originals have an authenticated exact-frame decode endpoint. Source capture is enabled only when that decoded original is ready; native adapter-only sources state that preview is unavailable instead of showing fixture pixels.
- **Media lifecycle:** Relink source is revision-backed. Generate proxy creates a real 1280×720 CFR H.264/AAC proxy at the project timeline rate and reports durable job progress.
- **Local project workflow:** create, open, recent-project selection, switch-project truth, and timeline rename are implemented; unavailable contract-preview actions are disabled with an explanation.
- **UI integrity:** Media folders filter the shared grid, the Animation curve editor respects the open Inspector, badge/action size floors are measured, and the expanded nine-item clip menu is clamped above the status footer.

### Gate-integrity corrections

- V8 coverage is mandatory in `qa`, with enforced floors of 65% statements, 51% branches, 63% functions, and 68% lines. The clean run measured 65.94%, 51.81%, 63.99%, and 68.37% respectively.
- JUnit reports use suite-specific filenames, preserving unit, property, standard integration, native runtime, visual, and coverage results.
- The reviewed manifest discovers and governs all 37 Playwright PNGs; together with three core artifacts, `fixture:verify` checks 40 files and rejects missing, stale, or mismatched entries.
- P22 strict visual validation remains part of `qa`. All eight required visual categories and both strict native repeat pairs pass.
- The local-render integration flushes its persistence queue before teardown, eliminating the previously exposed cleanup race.

### Clean final validation

- Lint, formatting, package boundaries, TypeScript, schema, production build, and local security checks passed.
- Unit: **78 files / 322 tests passed**.
- Property: **10 files / 20 tests passed**.
- Standard integration: **44 files / 85 tests passed**.
- Managed native runtime: **Remotion 1, HyperFrames 1, native composition 2 — all passed**.
- Visual manifest: **1/1 passed; 37 UI goldens and 40 total governed artifacts verified**.
- Isolated Chromium UI/visual E2E: **55/55 passed**.
- Authenticated temporary-project journey: **1/1 passed**, including real import, relink, proxy generation, decoded source frame/capture, timeline editing, rendering, and QA.
- Browser isolation reported `systemGoogleChromeSelected: false` and `persistentUserProfileConfigured: false` before the final authenticated run. Installed Google Chrome was not launched.

### Acceptance boundary

P28/V1 remains **blocked pending fresh owner acceptance**. The invalidated historical gate identity and evidence hashes were not reused or rewritten. No output was approved, no delivery was authorized, no permanent review decision was created, and no release was signed. The production build still emits a non-blocking main-chunk size advisory (579.15 kB minified), which remains a performance-hardening opportunity rather than a correctness-gate failure.

### Reporting-integrity follow-up

The final evidence-index inspection found that Playwright cleans its default `test-results` directory before browser runs, which also removed the newly separated Vitest JUnit files. JUnit output was therefore moved to `reports/junit`, and `qa` now requires eight distinct, well-formed suite reports outside Playwright's cleanup boundary. The complete managed QA rerun produced all eight reports. Their SHA-256 identities were captured before Playwright, then verified byte-for-byte unchanged after the 55-test isolated UI run and again after the authenticated temporary-project journey. The reporting-integrity blocker is closed.

## Replacement P28 local technical acceptance — 2026-07-18

The historical 2026-07-16 acceptance remains invalid. A new candidate evidence
chain was generated instead of reusing its identity.

### Additional corrections and proof

- All 17 distributable manifests use `1.0.0-rc.1`; the release contract directly
  observes `corepack pnpm 11.11.0`.
- The Remotion compositor is classified against the exact v4.0.489 repository
  licence while retaining the binary/codec and public-distribution review block.
- The minimum-width header has direct pairwise geometry coverage in every
  workspace. Two affected UI goldens and the 40-file checksum manifest were
  refreshed after visual inspection.
- The authenticated journey now imports owned PCM audio, performs a
  revision-backed overlapping edit, renders a three-frame MP4 with authoritative
  audio, probes both streams, and reaches QA passed without approval or delivery.
- Semantic rational FPS comparison prevents equivalent `30000/1001` objects
  from failing because of JSON property order.
- P03, P15, P18, and P21 contract drift was corrected to follow the current
  package set, truthful Inspector/Deliver actions, and centralized redaction
  authority.

### Final local results

- P23 security/isolation, P24 recovery, P26 performance, P27 release-candidate,
  and replacement P28 technical gates passed.
- P28 technical identity:
  `74db0a34e17928ab946954516cf447e34e061a9c17c2a5a3caf3971284ae8941`.
- Coverage: 132 files / 428 tests passed; 65.95% statements, 51.81% branches,
  64.00% functions, and 68.37% lines.
- Isolated bundled-Chromium E2E: 58/58 passed.
- Authenticated temporary-project A/V journey: 1/1 passed.
- Installed Google Chrome was not selected, and no persistent user profile was
  configured.

### Remaining authority

The registry vulnerability audit has not run because it would disclose the
dependency inventory to `https://registry.npmjs.org/`; explicit informed
permission is still required. Owner approval, immutable Version 1 binding,
signing, the stable `1.0.0` tag, delivery, and public distribution remain
untouched. The prepared receipt still has `releaseAuthorized: false`,
`signature: null`, and `pending-explicit-owner-approval`.

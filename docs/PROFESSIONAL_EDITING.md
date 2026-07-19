# Professional editing

Chai Studio's Professional Expansion keeps the Foundation authority model: integer master frames, normalized rational rates, immutable revisions, exact undo, deterministic preview/render evaluation, explicit engine ownership, and local-only personal macOS operation.

## Advanced trim

- **Roll** moves one shared boundary between adjacent clips. Both clips retain positive duration, source handles are validated through the exact timeline-to-source transform, linked pairs follow the explicit linked-media policy, and total sequence duration stays fixed.
- **Slip** holds the timeline range fixed and translates only the source range. Linked clips use their own rational source mapping. Source-handle overflow blocks the command.
- **Slide** holds the selected clip's duration and source range fixed while changing its position and reconciling both neighbor boundaries. The operation requires contiguous neighbors and sufficient handles.
- Every operation enters the normal timeline command history and returns an exact snapshot inverse. The macOS shortcuts are Option-[ / Option-] for roll, Option-, / Option-. for slip, and Shift-, / Shift-. for slide.

## Professional source monitor

The Media workspace source monitor has its own source frame, rate, scrubber, step controls, marks, and audition values. Source transport never mutates the master timeline clock.

Set source in/out, choose an unlocked target track, then choose insert, overwrite, or replace. The three-point resolver accepts any valid three-of-four source-in/source-out/timeline-in/timeline-out combination and derives the fourth endpoint with the same exact rational transform used by the timeline. The resulting edit is an ordinary reversible timeline command. Replace preserves the target clip's stable identity and timeline range.

## Compounds and versions

Compound creation requires contiguous clips on one track. It captures child clips, keyframes, automation, transitions, bridges, and dependency IDs in the versioned professional payload, replaces them with one nested clip, and uses a normalized nested rate. Flatten restores the exact child state. Nested timing and dependencies survive revision reopen.

Version stacks reference all alternate takes but only the active take changes the clip's render dependency. Switching a take preserves the clip ID and records the reviewed revision. Inactive takes remain available for comparison without entering the active render graph.

## Playback, speed, and remapping

- Forward, reverse, and freeze are explicit playback policies. Freeze samples one exact source frame; reverse and freeze default to muted audio unless the command selects another supported behavior.
- Constant speed is always a normalized rational. The command explicitly preserves either timeline duration or source range and reconciles the other side with declared boundary rounding.
- A time-remap curve owns unique integer timeline points and exact source-frame points. Forward-only curves reject decreasing source time; `allow-reverse` is explicit. Preview and render export and call the same evaluator, including signed floor behavior for reverse segments.

## Adjustment layers and range effects

Adjustment layers declare one exact affected range and effect ownership as common or engine-native. Cross-engine native effects require an explicit shared or bake fallback. Bake-required effects cannot be stored with a non-bake fallback. Cache invalidation queries return only affected adjustment and bridge ranges; the edit strip exposes the current count of range-cache dependencies.

## Advanced bridges

The Animation workspace bridge editor owns implementation, engine owner, outgoing/incoming handles, alpha convention, pre/post-roll, audio envelope, fallback, and boundary-QA status as one range record. Experimental shader/custom bridges cannot persist without both a fallback and passed QA. Boundary QA rejects missing frames, duplicate frames, blank coverage, and invalid alpha. Exact-range rendering uses the stored bridge range.

## Curves and audio automation

The curve editor supports property selection, multi-property selection, copy/paste, align, distribute, retime, value/speed graphs, auto/continuous/broken/flat tangent modes, zoom, and key navigation. Commands operate on stable keyframe IDs and round-trip through canonical serialization.

The audio surface edits clip and bus automation, generated ducking, ducking rules, equal-power/linear crossfades, sync anchors with sample tolerance, and a bounded local meter history. Every authoritative audio edit returns an inverse and an exact affected range when one exists. Meter history is preview evidence only; final audio still comes from the authoritative PCM mix and QA measurements.

## Persistence and recovery

Professional-only structures live in `professionalMetadata` under `chai-studio.professional-state.v1`. The payload is canonical, bigint-safe JSON inside the closed timeline revision schema. Unknown future payloads can be preserved without lossy interpretation; malformed or unsupported state is rejected. Autosave, named versions, history, repair, backup, and render recovery continue to operate on the whole immutable revision.

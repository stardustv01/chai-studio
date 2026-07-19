# Chai Studio Timeline Core

`@chai-studio/timeline` is the authoritative, engine-neutral editing model for Chai Studio. It owns stable entity identity, integer master-frame time, exact rational source transforms, immutable edit commands, structured diffs, validation, and rebuildable indexes. Render engines consume this model; they do not redefine it.

## Contract

- Persisted time uses signed, bounded `bigint` master frames and half-open `[start, end)` ranges.
- Frame-rate, source-rate, and speed calculations use normalized rationals. Floating point is display-only.
- Every edit is a pure command: input snapshot in, validated snapshot plus exact inverse out.
- Callers supply every new stable entity ID. Commands never generate identity from time or randomness.
- Locked tracks reject content edits. Linked clips require complete edit coverage.
- Video, caption, and data tracks reject overlaps. Audio tracks may overlap and route through ordered buses.
- Clip source ranges must remain inside available handles. Nested clips additionally respect nested duration and rate.
- Keyframes are reachable through a clip and/or matching automation lane and remain inside their owner range.
- Derived indexes are disposable. Rebuild them from the accepted snapshot after every committed edit.
- Canonical snapshot serialization tags master-frame bigints explicitly, sorts object keys, validates on decode, and round-trips byte-stably.

## Editing surface

The command union covers selection, move/nudge, insert, overwrite, replace, duplicate, clipboard paste, grouping/linking, split/blade, trim/ripple-trim, lift/delete/ripple-delete, persisted in/out ranges, track metadata/order, markers, automation lanes, and keyframes.

Clip commands also provide audited rename and merge/replace metadata edits. Derived indexes cover visible clips, active visual layers, nearby context, asset usage, transcript phrases, render dependencies/dependents, and normalized search. Transcript and render-dependency inputs are rebuildable supplements and never become timeline authority.

Each `TimelineEditResult` includes:

- `snapshot`: validated immutable output;
- `inverse`: exact snapshot restoration command;
- `label`: concise undo/history label;
- `diffSummary`: operation-aware human explanation;
- `diff`: deterministic entity/field-level structured diff;
- `affectedEntityIds`: stable IDs for invalidation and UI focus.

## Ripple policy

Markers choose `anchored-time` or `anchored-content`. Time-anchored markers remain at their program frame. Content-anchored markers follow insertion and ripple shifts; a content marker inside ripple-deleted material is removed. Keyframes follow their owning clip during move, insert, and ripple-delete.

## Safe usage

```ts
const result = executeTimelineCommand(snapshot, command);
persistAcceptedRevision(result.snapshot);
history.push({ label: result.label, inverse: result.inverse, diff: result.diff });
const indexes = buildTimelineDerivedIndexes(result.snapshot);
const canonicalBytes = serializeTimelineSnapshot(result.snapshot);
const reopened = deserializeTimelineSnapshot(canonicalBytes);
```

Use `createReferenceTimelineFixture()` for executable examples of linked A/V clips, ordered tracks and buses, mixed marker policies, and clip automation. The fixture passes the same core validator used by commands.

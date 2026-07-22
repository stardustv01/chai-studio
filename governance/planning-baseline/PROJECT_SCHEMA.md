# Chai Studio — Project Schema Contract Draft

**Status:** Draft v0.1; not frozen  
**Authority model:** Human-readable JSON plus immutable coordinated revisions

## Project folder

```text
project-name/
├── current-revision.json
├── revisions/<revision-id>/
│   ├── chai.project.json
│   ├── timeline.json
│   ├── assets.json
│   ├── settings.json
│   └── transaction.json
├── working/
├── scenes/{remotion,hyperframes,shared}/
├── assets/
├── transcripts/
├── captions/
├── captures/
├── reviews/
├── renders/
├── receipts/
├── autosaves/
└── .chai-cache/
```

## Global invariants

1. Stable IDs, never array position or display name, define relations.
2. Edit positions and durations are integer master frames.
3. Rates, time bases, and speed ratios are reduced rationals with positive denominators.
4. All ranges are `[startFrame, endFrame)`.
5. Every normal mutation declares `baseRevisionId`.
6. A commit writes and validates a complete immutable revision before replacing the current pointer.
7. Cache, job, and search databases are rebuildable and non-authoritative.
8. Approval and delivery state references immutable revisions and outputs.

## Required document roots

### `current-revision.json`

- `schemaVersion`
- `projectId`
- `revisionId`
- `revisionHash`
- `committedAt`

### `chai.project.json`

- Identity, title, timestamps, schema version.
- Default dimensions, rational FPS, color, and audio configuration.
- Active timeline and delivery profile.
- Engine and adapter version pins.
- Capability flags and rights notes.

### `timeline.json`

- Rational master FPS and integer duration.
- Ordered tracks and stable entities.
- Clips, source mappings, nested sequences, transitions, and bridges.
- Common/native property ownership and keyframes.
- Captions, transcripts, markers, annotations, audio automation, and approval references.

### `assets.json`

- Stable ID, canonical/project-relative path, and content hash.
- Media/container/codec/timing/audio/alpha/VFR metadata.
- Proxy mapping, thumbnail/waveform artifacts, rights, and validation state.

### `transaction.json`

- Command ID, actor, timestamp, parent and resulting revision IDs.
- Before/after hashes, affected entities, human summary, warnings, and source-edit metadata.

## Commit protocol

Validate command -> acquire mutation lock -> apply in working revision -> validate whole project -> write immutable revision -> flush -> atomically replace current pointer -> release lock.

Crash before pointer replacement leaves the previous revision authoritative. Orphan working revisions require explicit recovery action.

## Open schema questions for P02

- BigInt JSON encoding convention.
- Canonical JSON serialization and hash rules.
- Exact native-source dependency representation.
- Color and alpha contract enumeration.
- Approval and exception evidence schemas.
- External asset allowlist and portability rules.

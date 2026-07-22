# Chai Studio — UI Specification Draft

**Status:** Draft for P01 review  
**References:** `ui-samples/01-edit-workspace.png` through `05-animation-bridge-editor.png`

## Design rule

The program monitor and timeline dominate. Codex remains the only chat surface. Every visible production control must map to a defined command, query, event, state transition, or diagnostic.

## Workspaces

| Workspace | Primary surfaces |
|---|---|
| Edit | Media browser, program monitor, inspector, multitrack timeline, transport. |
| Inspect | Fidelity capture, A/B comparison, annotations, context manifest, warnings. |
| Media | Asset grid/list, metadata, rights, proxies, Foundation source inspection, transcript navigation. |
| Animation | Common/native keyframes, curves, bridge ownership, fallback and boundary status. |
| Deliver | Profiles, preflight, queue, DAG stages, outputs, QA, approvals, receipts. |

## Persistent global truth

- Project and revision identity.
- Authoritative frame/timecode.
- Interactive or fidelity preview mode.
- Proxy/original and native/baked state.
- Render, QA, approval, and delivery state.
- Security/trust warning when relevant.

## Interaction requirements

- Selection, focus, and keyboard-command ownership are distinct.
- Text entry suppresses conflicting editor shortcuts.
- Pointer cancellation commits no command.
- Drag and trim previews show the exact proposed command result.
- Multi-selection exposes only atomically safe shared edits.
- Approximate preview is never visually indistinguishable from fidelity.
- Errors show affected entity, stage/frame, repair action, and correlation ID.
- Empty, loading, reconnecting, stale, conflict, migration, recovery, read-only, and failure states are designed for every workspace.

## Source-monitor boundary

Foundation provides inspection, independent scrub/frame-step, metadata, safe audition, capture, and Codex context. Professional Expansion adds source marks, target-track patching, insert, overwrite, replace, and three-point editing.

## Accessibility baseline

Keyboard-complete workflows, visible focus, screen-reader names and timeline summaries, scalable text, high contrast, reduced motion, focus restoration, and no color-only status.

## Acceptance evidence

Each workspace requires state-gallery screenshots, interaction tests, keyboard checks, accessibility checks, and a control-to-contract table before implementation acceptance.

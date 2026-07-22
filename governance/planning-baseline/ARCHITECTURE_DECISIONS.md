# Chai Studio — Architecture Decision Index

**Status:** Draft index for P00 and P02 review

## Locked decisions

| ADR | Decision | Rationale |
|---|---|---|
| ADR-001 | Codex is the only conversation surface. | Avoid two competing conversational authorities. |
| ADR-002 | Version 1 is local-first and localhost-based. | Preserve privacy, direct file access, and low-friction iteration. |
| ADR-003 | Chai Studio owns the project and timeline. | Neither rendering engine may define product authority. |
| ADR-004 | Integer master frames and normalized rational rates are authoritative. | Prevent timing drift and ambiguous rounding. |
| ADR-005 | Ranges are half-open. | Make clip, render, bridge, caption, and audio boundaries consistent. |
| ADR-006 | Project commits are coordinated immutable revisions. | Prevent mixed-file partial state after crashes. |
| ADR-007 | Normal mutations use validated revision-bound commands. | Preserve concurrency, undo, audit, and recovery. |
| ADR-008 | Remotion and HyperFrames remain native behind adapters. | Preserve engine strengths and independent upgrades. |
| ADR-009 | One scheduler owns preview time. | Prevent uncontrolled engine clocks. |
| ADR-010 | One shared audio graph owns program audio. | Prevent drift and double mixing. |
| ADR-011 | Interactive preview and rendered fidelity are distinct states. | Keep visual truth explicit. |
| ADR-012 | Cross-engine effects use explicit bridges or baked fallbacks. | Avoid hidden conversion and boundary errors. |
| ADR-013 | Caches and indexes are regenerable only. | Protect creative and approval authority. |
| ADR-014 | Imported executable compositions require verified isolation. | Protect files, secrets, resources, and render integrity. |
| ADR-015 | Encoding does not imply delivery. | Preserve QA and approval authority. |
| ADR-016 | No desktop wrapper is a Foundation dependency. | Keep the core product portable and testable. |

## Recommended decisions awaiting evidence

| ADR | Recommendation | Gate |
|---|---|---|
| ADR-101 | React, TypeScript, and Vite for Studio web. | P02/P03 compatibility confirmation. |
| ADR-102 | Node.js 22+ and a pinned `pnpm` workspace. | Exact engine-version compatibility spike. |
| ADR-103 | Remotion as initial replaceable finishing compositor. | Mixed-engine quality, alpha, licensing, and performance spike. |
| ADR-104 | Shared Web Audio preview plus deterministic offline/FFmpeg final mix. | Long-timeline drift and parameter-parity spike. |
| ADR-105 | Transparent video default plus image-sequence fallback. | Target-machine alpha, decode, quality, and disk benchmark. |

## Change control

Changing a locked ADR requires an explicit replacement decision, impact analysis, migration plan, affected tests, security/license review where relevant, and named approval. Silent drift is invalid.

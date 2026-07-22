# Chai Studio — Product Requirements Draft

**Status:** Draft for P00 review  
**Source:** `CHAI_STUDIO_MASTER_PLAN.md`  
**Scope:** Foundation plus Professional Expansion

## Product outcome

Chai Studio is a local professional video project, editing, preview, capture, render, and QA system operated with Chai through Codex. Codex remains the only conversation surface.

## Primary user

Navin is the primary Version 1 user. The product optimizes for precise local iteration, truthful visual review, safe Codex-controlled changes, reproducible renders, and recovery—not accounts, cloud collaboration, or public onboarding.

## Required user journeys

| ID | Journey | Required outcome |
|---|---|---|
| J01 | Create, save, close, and reopen a project | Authoritative state and timing reproduce exactly. |
| J02 | Import and relink media | Hash, rights, proxy, VFR, font, and missing-source status remain visible. |
| J03 | Edit a mixed-engine timeline | Commands are reversible, revision-bound, and consistent across UI and CLI. |
| J04 | Preview and inspect | One scheduler controls all layers; approximation is visibly labeled. |
| J05 | Capture context for Codex | Selection and capture declare exact revision, frame, source, and fidelity mode. |
| J06 | Apply a Codex change | Validated command or source-edit transaction commits one coordinated revision. |
| J07 | Compare and review | A/B artifacts align by exact frame/range and preserve issue evidence. |
| J08 | Render and QA | Dependency graph, strict cache, centralized audio, QA, and receipt are complete. |
| J09 | Approve and deliver | Encoding cannot bypass QA, approval, or immutable delivery identity. |
| J10 | Recover | Crash, stale lock, missing source, corrupt cache, and interrupted render have explicit recovery. |

## Foundation requirements

| ID | Requirement |
|---|---|
| FR-001 | Store authoritative edit locations as integer master frames and rates as normalized rationals. |
| FR-002 | Preserve Remotion and HyperFrames as native, independently upgradeable engines behind adapters. |
| FR-003 | Maintain one coordinated immutable project revision selected by an atomic pointer. |
| FR-004 | Route normal authoritative mutations through validated commands with `baseRevisionId`. |
| FR-005 | Provide mixed-engine preview under one scheduler with visible interactive/fidelity distinction. |
| FR-006 | Provide exact fidelity capture through the declared final-compositor contract. |
| FR-007 | Maintain one authoritative audio graph for preview and final mix. |
| FR-008 | Use first-class bridge scenes or explicit baked fallbacks across engine boundaries. |
| FR-009 | Provide media hashing, probes, proxies, VFR mapping, fonts, rights, and final-source protection. |
| FR-010 | Provide transcript and deterministic caption artifacts for preview, render, QA, and export. |
| FR-011 | Expose revision-bound selection, capture, annotation, command, and source-edit context to Codex. |
| FR-012 | Render through a dependency DAG with strict environment identity and content-addressed cache. |
| FR-013 | Enforce `rendered_unchecked -> QA -> approved -> delivered` through one lifecycle authority. |
| FR-014 | Sandbox imported executable compositions or block their support. |
| FR-015 | Preserve human-readable creative, review, approval, and delivery authority outside caches/databases. |

## Professional Expansion requirements

- Roll, slip, and slide edits.
- Professional source monitor and three-point editing.
- Compound/nested clips and alternate takes.
- Freeze, reverse, rational speed changes, and time remapping.
- Advanced curve and keyframe editing.
- Adjustment layers and range effects.
- Advanced bridge transitions and fallbacks.
- Expanded audio automation and configurable shortcuts.

## Explicitly out of scope for Version 1

- Cloud collaboration and accounts.
- Multicam editing.
- Public plugin marketplace.
- Hosted/distributed rendering as a product dependency.
- Full nodal compositing, Resolve-grade color, or mastering-grade audio.
- Mobile editing.
- A second chat interface.

## Failure stories

- A stale Codex context attempts a mutation: reject and request refresh.
- A render succeeds but QA fails: output remains undeliverable.
- A worker crashes mid-publish: prior revision and valid cache remain intact.
- A source, font, runtime, or environment changes: dependent artifacts invalidate explicitly.
- Imported HTML attempts path, network, environment, process, or resource abuse: block and report.
- Real-time preview cannot keep up: degrade visibly and offer a rendered range.

## Acceptance rule

A requirement is accepted only with implementation evidence, automated tests, required visual/manual evidence, and traceability to a release gate. This draft does not itself accept any requirement.

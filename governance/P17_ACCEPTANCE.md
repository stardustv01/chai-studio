# P17 acceptance — Transcript and caption system

**Decision:** APPROVED for P18 implementation  
**Decision time:** 2026-07-16T06:05:36Z  
**Supported baseline:** personal-use macOS, Apple silicon, local-only runtime  
**Gate identity:** `07845d9e3427620b50a857d0cc2d770b93e2b966a2eb0c3e2676797f0988930c`

The P17 gate passed all 16 formal checks in one authoritative run: frozen offline install, the P17.01-P17.10 contract audit, browser-isolation enforcement, schema drift, strict lint/format/boundaries, strict compilation, 232 unit tests, 12 property/fuzz tests, 61 integrations including both real native engines, one fixture visual test, 26 isolated-browser end-to-end tests, 24 macOS UI goldens, production build, and security inspection.

## Task acceptance

| Task   | Result | Acceptance evidence                                                                                                                                                                                                               |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P17.01 | PASS   | Versioned transcript authority covers source-audio asset/hash/stream/sample rate, speakers, words, phrases, confidence, correction/lock state, exact half-open sample ranges, and exact rational frame mapping.                   |
| P17.02 | PASS   | SRT, VTT, and internal documents validate and normalize deterministically; malformed timing, missing headers, empty cues, invalid linkage, and impossible layouts are rejected without partial admission.                         |
| P17.03 | PASS   | Search, exact click-to-seek, phrase selection, current-phrase state, speaker/confidence filters, correction display, and deterministic single-word highlight sampling operate on authoritative timing.                            |
| P17.04 | PASS   | Phrase range, marker, split, caption generation, correction, and script comparison use typed command plans; timeline mutations return exact inverses and project history restores immutable language revisions.                   |
| P17.05 | PASS   | Caption cues preserve track/transcript/phrase/word/style identities, integer-frame trims, lock state, text, lines, and source linkage; phrase corrections atomically retime replacement words and update the linked cue.          |
| P17.06 | PASS   | The caption inspector exposes font family/size/weight, line height, text/box color, alignment, vertical position, safe area, line/CPS limits, highlighting, cue bounds, and locks with immediate semantic rejection.              |
| P17.07 | PASS   | Live and artifact QA covers safe placement, collision regions, reading speed, maximum lines/length, minimum duration, invalid layout, and per-track overlap with entity-scoped evidence.                                          |
| P17.08 | PASS   | Deterministic layer plans and SRT/VTT artifacts bind exact cue/word/line timing, declared highlight sampling, complete styles/layout, font and glyph hashes, collision results, QA anchors, and content identities.               |
| P17.09 | PASS   | The reviewed Media workspace synchronizes Foundation source inspection, transcript/caption selection, master-frame seek, timeline in/out range, markers, and split actions without making the source monitor clock authoritative. |
| P17.10 | PASS   | Round-trip, malformed-input, timing/property, Unicode/RTL, speaker/confidence, correction, lock, split/inverse, layout, collision, overlap, render-artifact, browser workflow, and macOS visual fixtures all pass.                |

## Authoritative language path

The accepted path is validated import or inspector intent -> strict typed `language.edit` or existing timeline command -> semantic validation -> immutable project revision -> authoritative resync. Transcript source-audio identity and timed word/phrase data remain authority; UI search/filter/selection and caption preview are projections. Phrase text correction atomically updates its word authority and linked caption cue. Timeline range, marker, and split operations use the accepted P05 command engine and exact inverse/history behavior.

Caption production is encoder-independent. One deterministic artifact bundle produces a compositor layer plan plus SRT/VTT delivery text. The plan declares `latest-start-then-stable-id` word sampling so rounded frame overlaps select exactly one word, and binds font/glyph dependencies, layout, collision results, QA anchors, and SHA-256 identities before P20 render execution consumes it.

## Authoritative evidence identities

| Artifact                                                                             | SHA-256                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `evidence/p17/gate-report.json`                                                      | `25fa7087626da8c1d30fdd8d01a1e1c4389ef57bf33a74b1dbc78cba555af036` |
| `packages/captions/src/artifacts.ts`                                                 | `05428d7542469be3bce59330a5601d09df6a897b24e7feea2a871457601729dc` |
| `packages/captions/src/commands.ts`                                                  | `5711b946a86e1405a1751d61fb48e69a05eea17a3819e513860c1d0ef88e099f` |
| `packages/captions/src/import.ts`                                                    | `848b293cc49f74439cc49dbe5216dc0ac4b2f198528102887d0853b278e3c967` |
| `packages/captions/src/navigation.ts`                                                | `958deb4d7529ae8ac1d7f62a8bad9d2eb57c5b7c792ab0005a9f7b488e29e490` |
| `packages/captions/src/qa.ts`                                                        | `9cb94cab911027b07f4e29e56c0a8bc521142e4b329a462cf2568807976a1d05` |
| `packages/captions/src/layout.ts`                                                    | `6cc51d995d8e2c7291b267349fdd4edceafeb0b303f86aaff6702c15b1003393` |
| `packages/schema/src/project-documents.ts`                                           | `38e35fd27651932d6c9661c12aefb75d61eb9d55b69d138d4050d3a7d2709b63` |
| `apps/studio-web/src/transcript-caption-panel.tsx`                                   | `1e577ac74727579dbd9afd6e8688660244c75d833ef0473ff15e8d509f23c67e` |
| `tests/e2e/transcript-caption.spec.ts`                                               | `bc6f8e4ca074b04e29419aeaa9fa8025f2ac1410266cbde7d5546dfea3dc90f8` |
| `tests/e2e/studio-visual.spec.ts-snapshots/p17-transcript-caption-system-darwin.png` | `05cdb3679b27c8947879e7967b7d19e19f78d9b94f298dee06d5796ab2eebfd0` |
| `scripts/validate-p17-caption-contract.mjs`                                          | `0a7d96395463754f6d84a75c9d13b34b185c16eec6e61c8f20032a6208d59038` |
| `pnpm-lock.yaml`                                                                     | `392dddfdbf937aa74c58318a6091d8ad7f2bc8f2b1a585d101feeebd23bb4546` |

The gate report hashes every accepted P17 implementation, schema, test, golden, and browser-safety boundary. Its stable identity binds platform, architecture, Node, lockfile, declared word-highlight sampling, Playwright-managed browser executable/identity, implementation hashes, and all gate outcomes.

## Controlled boundaries

- Transcript/caption mutations must continue through typed commands, semantic validation, immutable revision commit, and authoritative resync. Search, filters, textarea state, highlights, previews, and QA badges are never project authority.
- Source-audio asset/hash/stream/sample rate and exact word sample/frame mapping must remain attached through correction, reopen, render planning, and delivery. Silent floating-point or approximate-second remapping is prohibited.
- Malformed SRT/VTT/internal documents must fail before authoritative admission. Normalization may reorder and wrap deterministically but cannot silently change source timing or text meaning.
- Phrase corrections and linked caption cues cannot diverge silently. Locked phrases, words, or cues block the relevant edit; affected entity IDs must include replaced word and linked cue authority.
- Caption artifacts remain independent of the final encoder. P20 may consume their identities but cannot rebuild a weaker caption model or reverse the dependency.
- Safe zone, collision, line, duration, overlap, reading-speed, font, and glyph evidence remain visible and entity-scoped. Rendering or subtitle export never implies QA, approval, or delivery.
- The Foundation source inspector keeps its independent review-only clock. Transcript clicks may seek the master timeline explicitly; source inspection never mutates timeline authority implicitly.
- Installed Google Chrome remains prohibited. Every browser-launching check must pass isolation first and resolve to the verified Playwright-managed Chromium identity with a temporary profile.

P18 may now implement versioned selection/capture manifests, exact interactive/fidelity capture jobs, normalized reversible annotations, local Codex-friendly CLI/context commands, authorization and stale-context enforcement, sanitized bridge logging, source-edit bridging, and the full UI-to-context-to-command-to-fidelity-capture acceptance path without weakening any accepted command, revision, scheduler, audio, caption, QA-lifecycle, or browser-isolation boundary.

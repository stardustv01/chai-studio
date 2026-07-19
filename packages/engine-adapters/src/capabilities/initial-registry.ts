import type {
  CapabilityEngine,
  CapabilityEntry,
  CapabilityEvidence,
  CapabilityFamily,
  CapabilityFallback,
  CapabilityStatus,
} from "./contracts.js";
import { createCapabilityRegistry } from "./registry.js";

const sharedFixturePath = "tests/unit/shared-preview-adapter.test.ts";
const transitionFixturePath = "tests/property/shared-transitions.property.test.ts";
const registryFixturePath = "tests/unit/capability-registry.test.ts";
const remotionFixturePath = "tests/integration/remotion-real-runtime.test.ts";
const hyperframesFixturePath = "tests/integration/hyperframes-real-runtime.test.ts";
const hyperframesCapabilityFixturePath = "tests/unit/hyperframes-capability-upgrade.test.ts";

const evidence = (
  evidenceId: string,
  level: CapabilityEvidence["level"],
  artifactPath: string,
  assertion: string,
  testedVersion: string,
): CapabilityEvidence => ({ evidenceId, level, artifactPath, assertion, testedVersion });

const fallback = (
  fallbackId: string,
  kind: CapabilityFallback["kind"],
  owner: CapabilityEngine,
  fidelity: CapabilityFallback["fidelity"],
  limitations: readonly string[],
): CapabilityFallback => ({ fallbackId, kind, owner, fidelity, limitations });

const entry = (input: {
  capabilityId: string;
  family: CapabilityFamily;
  engine: CapabilityEngine;
  status: CapabilityStatus;
  owner?: CapabilityEngine;
  previewBehavior: CapabilityEntry["previewBehavior"];
  renderBehavior: CapabilityEntry["renderBehavior"];
  fallback?: CapabilityFallback;
  restrictions?: readonly string[];
  fixturePath: string;
  fixtureAssertions: readonly string[];
  evidence: readonly CapabilityEvidence[];
}): CapabilityEntry => ({
  capabilityId: input.capabilityId,
  family: input.family,
  engine: input.engine,
  status: input.status,
  owner: input.owner ?? input.engine,
  previewBehavior: input.previewBehavior,
  renderBehavior: input.renderBehavior,
  fallback: input.fallback ?? null,
  restrictions: input.restrictions ?? [],
  fixture: {
    fixtureId: `fixture.${input.capabilityId}`,
    testPath: input.fixturePath,
    assertions: input.fixtureAssertions,
  },
  evidence: input.evidence,
});

const sharedEvidence = (
  capabilityId: string,
  assertion: string,
  artifactPath = sharedFixturePath,
): readonly CapabilityEvidence[] => [
  evidence(`p12.${capabilityId}.deterministic`, "deterministic", artifactPath, assertion, "1.0.0"),
];

export const initialCapabilityEntries: readonly CapabilityEntry[] = [
  entry({
    capabilityId: "shared.typography",
    family: "typography",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Typography uses frozen font and glyph identities."],
    evidence: sharedEvidence("typography", "Typography dependencies are identity-bearing and deterministic."),
  }),
  entry({
    capabilityId: "shared.media",
    family: "media",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Image, video, and solid clips sample exact source frames."],
    evidence: sharedEvidence("media", "Shared visual sampling uses exact rational arithmetic."),
  }),
  entry({
    capabilityId: "shared.captions",
    family: "captions",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Caption cues obey half-open integer frame ranges and stable ordering."],
    evidence: sharedEvidence("captions", "Caption boundaries are deterministic and half open."),
  }),
  entry({
    capabilityId: "shared.audio",
    family: "audio",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Engine and source audio remain suppressed in the master program graph."],
    evidence: sharedEvidence("audio", "Program audio ownership is isolated from native clip audio."),
  }),
  entry({
    capabilityId: "remotion.react",
    family: "react",
    engine: "remotion",
    status: "native",
    previewBehavior: "native",
    renderBehavior: "native",
    fixturePath: remotionFixturePath,
    fixtureAssertions: ["Pinned Remotion React composition previews and renders exact frames."],
    evidence: [
      evidence(
        "p10.remotion.react.runtime",
        "runtime",
        remotionFixturePath,
        "Pinned Remotion runtime rendered the accepted M0 composition.",
        "4.0.489",
      ),
    ],
  }),
  entry({
    capabilityId: "hyperframes.html-css",
    family: "html-css",
    engine: "hyperframes",
    status: "native",
    previewBehavior: "native",
    renderBehavior: "native",
    fixturePath: hyperframesFixturePath,
    fixtureAssertions: ["Pinned HyperFrames HTML and CSS composition renders exact frames."],
    evidence: [
      evidence(
        "p11.hyperframes.html-css.runtime",
        "runtime",
        hyperframesFixturePath,
        "Pinned HyperFrames runtime rendered the accepted M0 composition.",
        "0.7.58",
      ),
    ],
  }),
  entry({
    capabilityId: "shared.svg",
    family: "svg",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Static SVG media follows shared alpha and transform rules."],
    evidence: sharedEvidence("svg", "Static SVG is handled by the shared visual path."),
  }),
  ...(["canvas", "lottie", "rive", "waapi"] as const).map((family) =>
    entry({
      capabilityId: `hyperframes.${family}`,
      family,
      engine: "hyperframes",
      status: "experimental",
      previewBehavior: "opt-in",
      renderBehavior: "opt-in",
      restrictions: ["Requires an explicit seek-safe frame adapter and project opt-in."],
      fixturePath: hyperframesCapabilityFixturePath,
      fixtureAssertions: [`${family} registration is discovered and seek-safe before opt-in.`],
      evidence: [
        evidence(
          `p11.hyperframes.${family}.detection`,
          "runtime",
          hyperframesCapabilityFixturePath,
          `${family} is detected only behind an explicit seek-safe adapter.`,
          "0.7.58",
        ),
      ],
    }),
  ),
  entry({
    capabilityId: "hyperframes.gsap",
    family: "gsap",
    engine: "hyperframes",
    status: "native",
    previewBehavior: "native",
    renderBehavior: "native",
    restrictions: ["Timeline must be paused and seeked from the authoritative master frame."],
    fixturePath: hyperframesFixturePath,
    fixtureAssertions: ["GSAP timeline is deterministic under repeated exact-frame seeks."],
    evidence: [
      evidence(
        "p11.hyperframes.gsap.visual",
        "visual",
        hyperframesFixturePath,
        "Accepted M0 frame samples and range render preserve GSAP timing.",
        "0.7.58",
      ),
    ],
  }),
  ...(["three-webgl", "shaders"] as const).map((family) =>
    entry({
      capabilityId: `hyperframes.${family}`,
      family,
      engine: "hyperframes",
      status: "bake_required",
      previewBehavior: "baked",
      renderBehavior: "baked",
      fallback: fallback(`fallback.baked-${family}`, "baked", "render-core", "equivalent", [
        "Interactive source controls are unavailable after baking.",
      ]),
      restrictions: ["Final output requires a deterministic pre-rendered artifact."],
      fixturePath: registryFixturePath,
      fixtureAssertions: [`${family} resolves to a provenance-bearing baked artifact.`],
      evidence: [
        evidence(
          `p11.hyperframes.${family}.detection`,
          "runtime",
          hyperframesCapabilityFixturePath,
          `${family} is detected but expensive state requires baking for stable shared composition.`,
          "0.7.58",
        ),
      ],
    }),
  ),
  entry({
    capabilityId: "hyperframes.particles",
    family: "particles",
    engine: "hyperframes",
    status: "fallback_available",
    previewBehavior: "proxy",
    renderBehavior: "baked",
    fallback: fallback("fallback.baked-particles", "baked", "render-core", "approximation", [
      "Fallback cannot preserve interactive particle controls.",
      "Random seeds must be frozen before bake.",
    ]),
    restrictions: ["Native path is not accepted until seeded seek-repeatability evidence exists."],
    fixturePath: registryFixturePath,
    fixtureAssertions: ["Particle fallback reports approximation limits and provenance."],
    evidence: [
      evidence(
        "p12.particles.policy",
        "contract",
        registryFixturePath,
        "Unproven particle implementations are routed to an explicit baked fallback.",
        "1.0.0",
      ),
    ],
  }),
  entry({
    capabilityId: "shared.transitions",
    family: "transitions",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: transitionFixturePath,
    fixtureAssertions: ["All transition primitives have one deterministic owner at every boundary frame."],
    evidence: sharedEvidence(
      "transitions",
      "Transition boundary property checks prove no gaps or duplicated ownership.",
      transitionFixturePath,
    ),
  }),
  entry({
    capabilityId: "shared.alpha",
    family: "alpha",
    engine: "shared",
    status: "unified",
    previewBehavior: "shared",
    renderBehavior: "shared",
    fixturePath: sharedFixturePath,
    fixtureAssertions: ["Straight and premultiplied alpha normalize to the shared pixel contract."],
    evidence: sharedEvidence("alpha", "Shared media preserves and declares alpha handling."),
  }),
  entry({
    capabilityId: "render-core.hdr-color-depth",
    family: "hdr-color-depth",
    engine: "render-core",
    status: "experimental",
    previewBehavior: "opt-in",
    renderBehavior: "opt-in",
    restrictions: ["Only SDR Rec.709 8-bit is release accepted in the current environment."],
    fixturePath: registryFixturePath,
    fixtureAssertions: ["HDR and higher color depth are blocked without explicit experimental opt-in."],
    evidence: [
      evidence(
        "p12.hdr.policy",
        "contract",
        registryFixturePath,
        "HDR remains opt-in until an accepted macOS display and encoder matrix exists.",
        "1.0.0",
      ),
    ],
  }),
  entry({
    capabilityId: "render-core.distributed-rendering",
    family: "distributed-rendering",
    engine: "render-core",
    status: "unsupported",
    previewBehavior: "blocked",
    renderBehavior: "blocked",
    restrictions: ["Personal macOS release supports local rendering only."],
    fixturePath: registryFixturePath,
    fixtureAssertions: ["Distributed rendering is rejected before execution."],
    evidence: [
      evidence(
        "p12.distributed.local-only",
        "contract",
        registryFixturePath,
        "The approved product scope is local personal macOS rendering.",
        "1.0.0",
      ),
    ],
  }),
];

export const initialCapabilityRegistry = createCapabilityRegistry(initialCapabilityEntries);

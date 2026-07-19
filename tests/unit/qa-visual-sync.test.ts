import { describe, expect, it } from "vitest";
import {
  createReviewChecklist,
  evaluateCaptionQa,
  evaluatePerceptualFidelity,
  evaluateStrictFidelity,
  evaluateSyncAnchor,
  evaluateVisualCheckpoint,
  recordReviewChecklistItem,
} from "../../packages/qa/src/index.js";

const hash = (value: string): string => value.repeat(64).slice(0, 64);

describe("visual, fidelity, caption, sync, and human checklist QA", () => {
  it("requires exact normalized pixels and the same strict environment", () => {
    const passed = evaluateStrictFidelity({
      fixtureId: "mixed-boundary",
      frame: "240",
      captureHash: hash("a"),
      finalHash: hash("a"),
      normalizedPixelHashAlgorithm: "rgba8-linear-rec709-v1",
      captureEnvironmentFingerprint: hash("b"),
      finalEnvironmentFingerprint: hash("b"),
    });
    expect(passed).toMatchObject({ status: "passed", blocking: true });

    const invalidEnvironment = evaluateStrictFidelity({
      fixtureId: "caption",
      frame: "420",
      captureHash: hash("c"),
      finalHash: hash("c"),
      normalizedPixelHashAlgorithm: "rgba8-linear-rec709-v1",
      captureEnvironmentFingerprint: hash("d"),
      finalEnvironmentFingerprint: hash("e"),
    });
    expect(invalidEnvironment).toMatchObject({ status: "failed" });
    expect(invalidEnvironment.detail).toContain("environment identities differ");
  });

  it("uses only fixture-measured perceptual thresholds with explicit modes", () => {
    const finding = evaluatePerceptualFidelity({
      policy: {
        fixtureId: "shader-cross-environment",
        mode: "ssim",
        direction: "minimum",
        measuredThreshold: 0.985,
        thresholdEvidenceHash: hash("f"),
        policyVersion: "shader-fixture-policy-v1",
      },
      frame: "600",
      observed: 0.982,
      captureHash: hash("1"),
      finalHash: hash("2"),
      captureEnvironmentFingerprint: hash("3"),
      finalEnvironmentFingerprint: hash("4"),
    });
    expect(finding).toMatchObject({ status: "warning", blocking: false });
    expect(finding.metrics[0]).toMatchObject({ name: "ssim", threshold: 0.985 });
  });

  it("links visual, caption, and synchronization failures to exact frames and ranges", () => {
    const visual = evaluateVisualCheckpoint({
      id: "boundary-after-0001",
      kind: "engine-boundary-after",
      frame: "301",
      artifactPath: "renders/output/frame-301.png",
      contentHash: hash("5"),
      nonBlank: false,
      unexpectedlyFrozen: false,
      alphaEdgePassed: true,
      proxyWatermarkDetected: false,
      sourceKind: "original",
      finalSourcesRequired: true,
      expectedGoldenHash: null,
      environmentFingerprint: hash("6"),
    });
    expect(visual).toMatchObject({ status: "failed", location: { frame: "301" } });

    const caption = evaluateCaptionQa({
      cueId: "cue-0001",
      startFrame: "420",
      endFrameExclusive: "510",
      charactersPerSecond: 34,
      maximumCharactersPerSecond: 28,
      maximumLineCharacters: 42,
      observedMaximumLineCharacters: 51,
      lineCount: 3,
      maximumLineCount: 2,
      contrastRatio: 3.2,
      minimumContrastRatio: 4.5,
      collisionFree: false,
      insideSafeZone: false,
      phraseSyncDeltaFrames: 4,
      maximumPhraseSyncDeltaFrames: 1,
      evidenceHashes: [hash("7")],
    });
    expect(caption).toMatchObject({ status: "failed", location: { frameRange: { startFrame: "420" } } });
    expect(caption.detail).toContain("phrase sync");

    const sync = evaluateSyncAnchor({
      id: "vo-anchor-0001",
      kind: "vo-visual",
      expectedFrame: "720",
      observedFrame: "723",
      frameDelta: "3",
      maximumAbsoluteFrameDelta: "1",
      expectedSample: "1153152",
      observedSample: "1157952",
      sampleDelta: "4800",
      maximumAbsoluteSampleDelta: "1602",
      evidenceHashes: [hash("8")],
    });
    expect(sync).toMatchObject({ status: "failed", location: { frame: "723" } });
    expect(sync.metrics.map((metric) => metric.name)).toEqual(["frameDelta", "sampleDelta"]);
  });

  it("cannot complete human review without evidence for every required checkpoint", () => {
    const checklist = createReviewChecklist({
      id: "checklist-0001",
      outputId: "output-0001",
      revisionId: "revision-0001",
      checkpoints: [
        {
          category: "first-frame",
          frame: "0",
          entityIds: [],
          instruction: "Confirm intentional first frame.",
        },
        {
          category: "boundary",
          frame: "300",
          entityIds: ["bridge-0001"],
          instruction: "Confirm no missing or duplicate boundary frame.",
        },
      ],
    });
    const firstItem = checklist.items[0];
    if (firstItem === undefined) throw new Error("Checklist fixture did not create the first item.");
    const reviewed = recordReviewChecklistItem(checklist, {
      itemId: firstItem.id,
      status: "passed",
      reviewerId: "reviewer-0001",
      evidenceHashes: [hash("9")],
      reviewedAt: "2026-07-16T10:40:00.000Z",
    });
    expect(reviewed.complete).toBe(false);
    expect(reviewed.identityHash).not.toBe(checklist.identityHash);
  });
});

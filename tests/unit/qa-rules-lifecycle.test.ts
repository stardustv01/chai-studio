import { describe, expect, it } from "vitest";
import { serializeBigInt } from "../../packages/schema/src/rational.js";
import {
  assertQaLifecycleTransition,
  centralizedQaRules,
  createQaReport,
  createPreRenderQaReport,
  evaluateAudioMeasurements,
  evaluateStructuralOutput,
  qaRuleSetIdentity,
  exceptionApplies,
} from "../../packages/qa/src/index.js";

describe("centralized QA rules and exclusive lifecycle", () => {
  it("defines one versioned pre/post/review rule set identity", () => {
    const rules = centralizedQaRules();
    expect(rules).toHaveLength(22);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    expect(qaRuleSetIdentity(rules)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports exact structural fields and measured audio failures", () => {
    const structural = evaluateStructuralOutput({
      artifactPath: "renders/output/master.mp4",
      probeEvidenceHash: "c".repeat(64),
      probeVersion: "ffprobe fixture",
      readable: true,
      contentHash: "a".repeat(64),
      expectedContentHash: "a".repeat(64),
      durationFrames: "100",
      expectedDurationFrames: "101",
      width: 1920,
      height: 1080,
      expectedWidth: 1920,
      expectedHeight: 1080,
      fps: { denominator: "1001", numerator: "30000" },
      expectedFps: { numerator: "30000", denominator: "1001" },
      container: "mp4",
      expectedContainer: "mp4",
      videoCodec: "h264",
      expectedVideoCodec: "h264",
      audioCodec: "aac",
      expectedAudioCodec: "aac",
      audioPresent: true,
      expectedAudio: true,
      sampleRate: 48_000,
      expectedSampleRate: 48_000,
      channels: 2,
      expectedChannels: 2,
      frameCount: "100",
      frame: null,
      frameRange: { startFrame: "0", endFrameExclusive: "101" },
    });
    expect(structural).toMatchObject({ status: "failed", blocking: true });
    expect(structural.detail).toContain("duration");
    expect(structural.detail).toContain("frame count");
    expect(structural.detail).not.toContain("rational FPS");

    const audio = evaluateAudioMeasurements({
      artifactHash: "b".repeat(64),
      durationSamples: "48000",
      expectedDurationSamples: "48000",
      integratedLufs: -16,
      targetLufs: -16,
      loudnessToleranceLufs: 1,
      truePeakDbtp: 0.2,
      maximumTruePeakDbtp: -1,
      clippedSampleCount: 1,
      silentSampleCount: 0,
      totalSampleCount: "96000",
      channels: 2,
      expectedChannels: 2,
      syncDeltaSamples: "0",
      maximumSyncDeltaSamples: "1",
    });
    expect(audio).toMatchObject({ status: "failed", severity: "error" });
    expect(audio.metrics.map((metric) => metric.name)).toEqual(["integratedLufs", "truePeak", "syncDelta"]);
  });

  it("projects delivery preflight through the same 14 centralized pre-render rules", () => {
    const report = createPreRenderQaReport({
      id: "qa-preflight-report-0001",
      projectId: "project-qa-0001",
      revisionId: "revision-qa-0001",
      createdAt: "2026-07-16T10:30:00.000Z",
      findings: [
        {
          code: "delivery.rights.unresolved",
          severity: "error",
          blocking: true,
          title: "Rights unresolved",
          detail: "One source lacks delivery evidence.",
          repair: "Attach rights evidence.",
        },
      ],
      evidenceHashes: ["d".repeat(64)],
      environmentFingerprint: "e".repeat(64),
    });
    expect(report.findings).toHaveLength(14);
    expect(report.state).toBe("qa_failed");
    expect(report.findings.find((finding) => finding.ruleId === "qa.pre.rights")).toMatchObject({
      status: "failed",
      repairHint: "Attach rights evidence.",
    });
    expect(report.findings.find((finding) => finding.ruleId === "qa.pre.schema")).toMatchObject({
      status: "passed",
    });
  });

  it("blocks lifecycle bypass and requires matching QA evidence", () => {
    expect(() => {
      assertQaLifecycleTransition({
        from: "rendered_unchecked",
        currentOutputId: "output-qa-0001",
        to: "approved",
        outputId: "output-qa-0001",
        report: null,
        exceptions: [],
        evidenceHashes: ["a".repeat(64)],
        now: "2026-07-16T10:30:00.000Z",
      });
    }).toThrow(/forbidden/i);

    const report = createQaReport({
      id: "qa-report-0001",
      projectId: "project-qa-0001",
      revisionId: "revision-qa-0001",
      outputId: "output-qa-0001",
      ruleSetIdentity: qaRuleSetIdentity(),
      rules: centralizedQaRules().map(({ id, version }) => ({ id, version })),
      findings: [],
      createdAt: "2026-07-16T10:30:00.000Z",
    });
    expect(report.state).toBe("qa_passed");
    expect(() => {
      assertQaLifecycleTransition({
        from: "rendered_unchecked",
        currentOutputId: "output-qa-0001",
        to: "qa_passed",
        outputId: "output-qa-0001",
        report,
        exceptions: [],
        evidenceHashes: [report.identityHash],
        now: "2026-07-16T10:30:00.000Z",
      });
    }).not.toThrow();
  });

  it("applies an exception only to its active output, code, entity, and frame scope", () => {
    const finding = evaluateStructuralOutput({
      artifactPath: "renders/output/master.mp4",
      probeEvidenceHash: "c".repeat(64),
      probeVersion: "ffprobe fixture",
      readable: false,
      contentHash: "a".repeat(64),
      expectedContentHash: null,
      durationFrames: "100",
      expectedDurationFrames: "100",
      width: 1920,
      height: 1080,
      expectedWidth: 1920,
      expectedHeight: 1080,
      fps: null,
      expectedFps: null,
      container: "mp4",
      expectedContainer: "mp4",
      videoCodec: "h264",
      expectedVideoCodec: "h264",
      audioCodec: null,
      expectedAudioCodec: null,
      audioPresent: false,
      expectedAudio: false,
      sampleRate: null,
      expectedSampleRate: null,
      channels: null,
      expectedChannels: null,
      frameCount: "100",
      frame: null,
      frameRange: { startFrame: "0", endFrameExclusive: "100" },
    });
    const scopedFinding = {
      ...finding,
      location: {
        ...finding.location,
        entityIds: ["clip-0001"],
        frameRange: { startFrame: "10", endFrameExclusive: "20" },
      },
    };
    const exception = {
      id: "exception-0001",
      issueId: "issue-0001",
      scope: {
        kind: "qa-code" as const,
        entityIds: ["clip-0001"],
        frameRange: { startFrame: serializeBigInt(0n), endFrameExclusive: serializeBigInt(30n) },
        qaCodes: [finding.ruleId],
        outputId: "output-0001",
      },
      reason: "Reviewed fixture limitation",
      evidenceHashes: ["b".repeat(64)],
      approver: { id: "reviewer-0001", kind: "user" as const, sessionId: "session-review-0001" },
      acceptedAt: "2026-07-16T10:30:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      reviewAt: "2026-07-30T00:00:00.000Z",
      active: true,
    };
    expect(exceptionApplies(scopedFinding, "output-0001", [exception], "2026-07-16T10:40:00.000Z")).toBe(
      true,
    );
    expect(exceptionApplies(scopedFinding, "output-0002", [exception], "2026-07-16T10:40:00.000Z")).toBe(
      false,
    );
    expect(exceptionApplies(scopedFinding, "output-0001", [exception], "2026-08-02T00:00:00.000Z")).toBe(
      false,
    );
  });
});

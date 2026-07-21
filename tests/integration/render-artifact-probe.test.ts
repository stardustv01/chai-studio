import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  builtInDeliveryProfiles,
  createDeliveryProfile,
  type DeliveryProfileSeed,
} from "../../packages/render/src/delivery.js";
import { hashCanonicalRenderValue } from "../../packages/render/src/identity.js";
import {
  verifyOutputQa,
  type RenderOutputRecord,
  type RenderReceiptBase,
} from "../../apps/studio-server/src/render-service.js";

const temporaryDirectories: string[] = [];
const redSixteenBySixteenPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAF0lEQVR4nGP4w8BAEiJN9aiGUQ1DSgMA9a78AVcOhtgAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("post-render artifact probing", () => {
  it("probes a still as one exact frame with no FPS or audio requirement", async () => {
    const fixture = await stillFixture({ width: 16, height: 16 });
    const result = await verifyOutputQa({
      output: fixture.output,
      rootPath: fixture.root,
      signal: new AbortController().signal,
      report: () => undefined,
    });

    expect(result).toMatchObject({
      state: "qa_passed",
      audio: { status: "not-applicable" },
      primaryArtifactProbe: {
        status: "probed",
        artifactPath: "renders/output-probe-0001/frame-48.png",
        inspection: {
          hasAudio: false,
          videoStreams: [{ codec: "png", width: 16, height: 16 }],
        },
      },
      findings: [
        {
          ruleId: "qa.post.structure",
          status: "passed",
          location: { frame: "48", frameRange: null },
        },
      ],
    });
    expect(result.findings?.[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "durationFrames", value: "1", threshold: "1" }),
        expect.objectContaining({ name: "frameCount", value: "1", threshold: "1" }),
        expect.objectContaining({ name: "audioPresent", value: false, threshold: false }),
      ]),
    );
  });

  it("fails when ffprobe dimensions disagree with the requested profile", async () => {
    const fixture = await stillFixture({ width: 1920, height: 1080 });
    const result = await verifyOutputQa({
      output: fixture.output,
      rootPath: fixture.root,
      signal: new AbortController().signal,
      report: () => undefined,
    });

    expect(result.state).toBe("qa_failed");
    expect(result.findings?.[0]).toMatchObject({ status: "failed" });
    expect(result.findings?.[0]?.detail).toContain("width");
    expect(result.findings?.[0]?.detail).toContain("height");
  });
});

const stillFixture = async (dimensions: { readonly width: number; readonly height: number }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-render-probe-"));
  temporaryDirectories.push(root);
  const relativePath = "renders/output-probe-0001/frame-48.png";
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, redSixteenBySixteenPng);
  const contentHash = createHash("sha256").update(redSixteenBySixteenPng).digest("hex");
  const baseProfile = builtInDeliveryProfiles().find((profile) => profile.id === "profile-still-png");
  if (baseProfile === undefined) throw new Error("Still profile fixture is unavailable.");
  const baseProfileSeed: DeliveryProfileSeed = {
    id: baseProfile.id,
    name: baseProfile.name,
    kind: baseProfile.kind,
    purpose: baseProfile.purpose,
    outputKind: baseProfile.outputKind,
    width: baseProfile.width,
    height: baseProfile.height,
    fps: baseProfile.fps,
    container: baseProfile.container,
    videoCodec: baseProfile.videoCodec,
    audioCodec: baseProfile.audioCodec,
    audioSampleRate: baseProfile.audioSampleRate,
    colorSpace: baseProfile.colorSpace,
    alpha: baseProfile.alpha,
    sourcePolicy: baseProfile.sourcePolicy,
    strictEnvironment: baseProfile.strictEnvironment,
    outputPathTemplate: baseProfile.outputPathTemplate,
  };
  const profile = createDeliveryProfile({ ...baseProfileSeed, ...dimensions });
  const artifacts = [
    {
      relativePath,
      byteLength: redSixteenBySixteenPng.byteLength,
      contentHash,
      primary: true,
    },
  ];
  const strictEnvironmentFingerprint = "e".repeat(64);
  const withoutIdentity: Omit<RenderReceiptBase, "identityHash"> = {
    schemaVersion: "1.0.0",
    receiptVersion: "1.0.0",
    outputId: "output-probe-0001",
    projectId: "project-probe-0001",
    sourceRevisionId: "revision-probe-0001",
    sourceRevisionHash: "b".repeat(64),
    renderRequestId: "request-probe-0001",
    jobId: "job-probe-0001",
    startedAt: "2026-07-17T00:00:00.000Z",
    completedAt: "2026-07-17T00:00:01.000Z",
    deliveryProfile: profile,
    renderScope: { kind: "frame", frame: "48" },
    engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
    environment: {
      mode: "strict",
      strictEnvironmentFingerprint,
      compatiblePreviewFingerprint: "c".repeat(64),
      strictManifestHash: "d".repeat(64),
      browserIdentity: "not-applicable:probe-fixture",
      status: "recorded",
    },
    dependencies: {
      manifestHash: "f".repeat(64),
      entryCount: 1,
      lockfileHash: "1".repeat(64),
      status: "recorded",
    },
    security: {
      schemaVersion: "1.0.0",
      policyIdentity: "2".repeat(64),
      trustClasses: ["trusted_authored"],
      workerPoolIds: ["worker-probe-fixture"],
      cacheNamespaces: ["cache-probe-fixture"],
      environmentIdentity: strictEnvironmentFingerprint,
      approvedNetworkHashes: [],
      isolationEvidenceHash: null,
      violations: [],
    },
    dag: {
      id: "dag-probe-0001",
      nodeCount: 1,
      rootIds: ["node-probe-0001"],
      range: { startFrame: "48", endFrameExclusive: "49" },
      fps: { numerator: "30000", denominator: "1001" },
    },
    cacheLineage: [],
    artifacts,
    audio: {
      status: "not-applicable",
      measurementVersion: null,
      reason: "delivery-profile-declares-no-audio",
    },
    captions: { status: "not-evaluated" },
    preflight: {
      status: "passed",
      planIdentityHash: "3".repeat(64),
      findingCodes: [],
      ruleSetVersions: ["probe-fixture-v1"],
    },
    initialLifecycleState: "rendered_unchecked",
    warnings: [],
    reproduction: { status: "recorded", commands: ["probe-fixture"] },
    approval: null,
    delivered: false,
  };
  const receipt: RenderReceiptBase = {
    ...withoutIdentity,
    identityHash: hashCanonicalRenderValue(withoutIdentity as never),
  };
  const output: RenderOutputRecord = {
    schemaVersion: "1.0.0",
    id: receipt.outputId,
    projectId: receipt.projectId,
    sourceRevisionId: receipt.sourceRevisionId,
    activationRevisionId: "revision-probe-0002",
    renderRequestId: receipt.renderRequestId,
    jobId: receipt.jobId,
    profile,
    scope: receipt.renderScope,
    artifacts,
    receiptIdentityHash: receipt.identityHash,
    lifecycleState: receipt.initialLifecycleState,
    createdAt: receipt.completedAt,
  };
  const receiptPath = path.join(root, "receipts", "renders", output.id, "render.json");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  return { root, output };
};

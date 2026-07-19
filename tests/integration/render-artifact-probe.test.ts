import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtInDeliveryProfiles } from "../../packages/render/src/delivery.js";
import {
  verifyOutputQa,
  type RenderOutputRecord,
  type RenderReceiptBase,
} from "../../apps/studio-server/src/render-service.js";

const temporaryDirectories: string[] = [];
const redTwoByTwoPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4w8AARAwQCgAfjgPxzzTeXgAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("post-render artifact probing", () => {
  it("probes a still as one exact frame with no FPS or audio requirement", async () => {
    const fixture = await stillFixture({ width: 2, height: 2 });
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
          videoStreams: [{ codec: "png", width: 2, height: 2 }],
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
  await writeFile(absolutePath, redTwoByTwoPng);
  const contentHash = createHash("sha256").update(redTwoByTwoPng).digest("hex");
  const baseProfile = builtInDeliveryProfiles().find((profile) => profile.id === "profile-still-png");
  if (baseProfile === undefined) throw new Error("Still profile fixture is unavailable.");
  const profile = { ...baseProfile, ...dimensions };
  const output: RenderOutputRecord = {
    schemaVersion: "1.0.0",
    id: "output-probe-0001",
    projectId: "project-probe-0001",
    sourceRevisionId: "revision-probe-0001",
    activationRevisionId: "revision-probe-0002",
    renderRequestId: "request-probe-0001",
    jobId: "job-probe-0001",
    profile,
    scope: { kind: "frame", frame: "48" },
    artifacts: [
      {
        relativePath,
        byteLength: redTwoByTwoPng.byteLength,
        contentHash,
        primary: true,
      },
    ],
    receiptIdentityHash: "a".repeat(64),
    lifecycleState: "rendered_unchecked",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
  const receipt = {
    dag: {
      range: { startFrame: "48", endFrameExclusive: "49" },
      fps: { numerator: "30000", denominator: "1001" },
    },
    audio: {
      status: "not-applicable",
      measurementVersion: null,
      reason: "delivery-profile-declares-no-audio",
    },
  } as RenderReceiptBase;
  const receiptPath = path.join(root, "receipts", "renders", output.id, "render.json");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  return { root, output };
};

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentAddressedArtifactStore,
  InjectedReliabilityFault,
  ReliabilityFaultInjector,
  RenderRecoveryJournalStore,
  runAtomicEncode,
  type DeliveryEncodeProfile,
  type ReliabilityFaultPoint,
} from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

const roots: string[] = [];
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P24 resumable recovery and fault injection", () => {
  it("reuses only complete hash-validated artifacts after a process restart", async () => {
    const root = await temporaryRoot();
    const artifactPath = path.join(root, "renders", "output-recovery", "master.mp4");
    await writeFileEnsured(artifactPath, "valid-render");
    const first = new RenderRecoveryJournalStore(root, () => new Date("2026-07-16T20:00:00.000Z"));
    let record = await first.begin({
      requestId: "render-request-recovery",
      retryOfRequestId: null,
      projectId: "project-recovery",
      revisionId: "revision-recovery",
      outputId: "output-recovery",
    });
    record = await first.advance(record, { stage: "operation-started", status: "running" });
    record = await first.advance(record, { stage: "render-stage-complete" });
    record = await first.advance(record, {
      stage: "artifacts-validated",
      validatedArtifacts: [
        {
          relativePath: "renders/output-recovery/master.mp4",
          contentHash: hash("valid-render"),
          byteLength: Buffer.byteLength("valid-render"),
          primary: true,
        },
      ],
    });
    await first.fail(record, {
      cancelled: false,
      error: "receipt write interrupted",
      partialOutputRetained: true,
    });

    const restarted = new RenderRecoveryJournalStore(root);
    expect(await restarted.resumeContext("render-request-recovery")).toMatchObject({
      priorRequestId: "render-request-recovery",
      completedStages: [
        "request-persisted",
        "operation-started",
        "render-stage-complete",
        "artifacts-validated",
      ],
      validatedArtifacts: [{ contentHash: hash("valid-render"), primary: true }],
    });

    await writeFile(artifactPath, "corrupt-render");
    expect((await restarted.resumeContext("render-request-recovery"))?.validatedArtifacts).toEqual([]);
    await expect(restarted.advance(record, { stage: "request-persisted" })).rejects.toThrow("backwards");
  });

  it("injects every required failure boundary exactly when armed", () => {
    const points: readonly ReliabilityFaultPoint[] = [
      "revision-write",
      "cache-publish",
      "render-stage",
      "encode-finalize",
      "receipt-write",
      "approval-transition",
      "lifecycle-intent-written",
      "lifecycle-revision-committed",
    ];
    const injector = new ReliabilityFaultInjector();
    for (const point of points) injector.arm(point);
    for (const point of points) {
      expect(() => {
        injector.checkpoint(point);
      }).toThrow(InjectedReliabilityFault);
      expect(() => {
        injector.checkpoint(point);
      }).not.toThrow();
    }
    expect(injector.armed()).toEqual([]);
  });

  it("keeps cache publication valid and encode finalization invisible across injected crashes", async () => {
    const root = await temporaryRoot();
    const source = path.join(root, "source.bin");
    await writeFile(source, "cache-bytes");
    const injector = new ReliabilityFaultInjector();
    injector.arm("cache-publish");
    const cacheKey = hash("cache-key");
    const environmentHash = hash("environment");
    const dependenciesHash = hash("dependencies");
    const store = new ContentAddressedArtifactStore(
      path.join(root, "cache"),
      () => new Date("2026-07-16T20:00:00.000Z"),
      (point) => {
        injector.checkpoint(point);
      },
    );
    await expect(
      store.publish({
        cacheKey,
        sourcePath: source,
        descriptor: {
          artifactId: "artifact-cache-recovery",
          class: "intermediate",
          mediaType: "application/octet-stream",
          extension: "bin",
          frameRange: null,
          alphaMode: null,
          colorSpace: null,
          pixelFormat: null,
        },
        dependencyManifestHash: dependenciesHash,
        strictEnvironmentFingerprint: environmentHash,
        portableEnvironmentContractHash: null,
        producerNodeId: "node-cache-recovery",
      }),
    ).rejects.toThrow("cache-publish");
    expect(
      await store.lookup({
        cacheKey,
        strictEnvironmentFingerprint: environmentHash,
        portableEnvironmentContractHash: null,
      }),
    ).toMatchObject({ status: "hit", reason: "validated-strict" });

    const output = path.join(root, "delivery", "master.mp4");
    injector.arm("encode-finalize");
    await expect(
      runAtomicEncode({
        inputPaths: [source],
        outputPath: output,
        profile,
        signal: new AbortController().signal,
        report: () => undefined,
        runner: async ({ temporaryOutputPath }) => writeFile(temporaryOutputPath, "encoded"),
        checkpoint: (point) => {
          injector.checkpoint(point);
        },
      }),
    ).rejects.toThrow("encode-finalize");
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(path.dirname(output))).some((name) => name.includes("partial"))).toBe(false);
  });
});

const profile: DeliveryEncodeProfile = {
  id: "profile-recovery-h264",
  outputClass: "delivery",
  width: 1920,
  height: 1080,
  fps: normalizeRational(30n, 1n),
  container: "mp4",
  videoCodec: "libx264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  colorSpace: "rec709",
  alphaMode: "opaque",
  quality: "final",
};

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-render-recovery-"));
  roots.push(root);
  return root;
};

const writeFileEnsured = async (target: string, content: string): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

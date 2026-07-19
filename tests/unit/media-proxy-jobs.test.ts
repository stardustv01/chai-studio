import { describe, expect, it } from "vitest";
import { ProxyJobController, type GeneratedProxyArtifact } from "../../packages/media/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

describe("proxy background jobs", () => {
  it("runs jobs asynchronously and exposes immutable completed state", async () => {
    const jobs = new ProxyJobController();
    const queued = jobs.enqueue({
      id: "proxy-job-0001",
      sourceAssetId: "asset-proxy-0001",
      profileId: "profile-proxy-0001",
      task: () => Promise.resolve(artifact()),
    });
    expect(queued.status).toBe("queued");
    expect((await jobs.wait("proxy-job-0001")).proxyContentHash).toBe("b".repeat(64));
    expect(jobs.get("proxy-job-0001").status).toBe("completed");
    expect(() =>
      jobs.enqueue({
        id: "proxy-job-0001",
        sourceAssetId: "asset-proxy-0001",
        profileId: "profile-proxy-0001",
        task: () => Promise.resolve(artifact()),
      }),
    ).toThrow(/already exists/);
  });

  it("cancels queued work without publishing an artifact", async () => {
    const jobs = new ProxyJobController();
    jobs.enqueue({
      id: "proxy-job-0002",
      sourceAssetId: "asset-proxy-0001",
      profileId: "profile-proxy-0001",
      task: () => Promise.resolve(artifact()),
    });
    expect(jobs.cancel("proxy-job-0002").status).toBe("cancelled");
    await expect(jobs.wait("proxy-job-0002")).rejects.toThrow(/cancelled/);
    expect(jobs.list()).toEqual([expect.objectContaining({ id: "proxy-job-0002", status: "cancelled" })]);
  });
});

const artifact = (): GeneratedProxyArtifact => ({
  schemaVersion: "1.0.0",
  sourceAssetId: "asset-proxy-0001",
  sourceContentHash: "a".repeat(64),
  proxyContentHash: "b".repeat(64),
  profileId: "profile-proxy-0001",
  profileFingerprint: "c".repeat(64),
  cacheKey: "d".repeat(64),
  outputFilePath: "/tmp/proxy.mp4",
  timeMap: {
    schemaVersion: "1.0.0",
    sourceContentHash: "a".repeat(64),
    proxyContentHash: "b".repeat(64),
    targetFrameRate: normalizeRational(25n, 1n),
    proxyFrameCount: "0",
    variableFrameRateSource: false,
    mappings: [],
  },
});

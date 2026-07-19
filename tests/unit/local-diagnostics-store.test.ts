import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalDiagnosticsStore,
  listLocalCrashRecords,
} from "../../apps/studio-server/src/local-diagnostics-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P24 local diagnostics privacy and rotation", () => {
  it("rotates bounded structured logs and searches by correlation without leaking secrets", async () => {
    const root = await temporaryRoot();
    let tick = 0;
    const store = new LocalDiagnosticsStore({
      projectRoot: root,
      maximumBytes: 4_096,
      maximumFiles: 2,
      now: () => new Date(1_752_700_000_000 + tick++ * 1_000),
    });
    const first = await store.append({
      severity: "error",
      category: "render",
      event: "render.stage.failed",
      correlationId: "correlation-local-diagnostics",
      projectId: "project-local-diagnostics",
      revisionId: "revision-local-diagnostics",
      entityId: "clip-local-diagnostics",
      stage: "encode-finalize",
      frame: "120",
      durationMs: 321,
      memoryMiB: 512,
      concurrency: 2,
      cacheReason: "content-corrupt",
      data: {
        token: "secret-token",
        path: `${root}/renders/master.mp4`,
        engineConsole: "Authorization: Bearer private-value",
      },
    });
    for (let index = 0; index < 8; index += 1) {
      await store.append({
        severity: "info",
        category: "environment",
        event: "health.sample",
        correlationId: `correlation-${String(index).padStart(3, "0")}`,
        projectId: "project-local-diagnostics",
        revisionId: "revision-local-diagnostics",
        entityId: null,
        stage: "health",
        frame: null,
        durationMs: index,
        memoryMiB: 256,
        concurrency: 1,
        cacheReason: null,
        data: { sample: "x".repeat(180) },
      });
    }
    const matches = await store.search({
      correlationId: "correlation-local-diagnostics",
      limit: 200,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(first.id);
    const serialized = JSON.stringify(matches[0]);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain(root);
    expect(serialized).toContain("<project>");
  });

  it("requires explicit record selection and creates only a redacted metadata bundle", async () => {
    const root = await temporaryRoot();
    const store = new LocalDiagnosticsStore({ projectRoot: root });
    const record = await store.append({
      severity: "warning",
      category: "media",
      event: "media.probe.failed",
      correlationId: "correlation-support-bundle",
      projectId: "project-support-bundle",
      revisionId: "revision-support-bundle",
      entityId: "asset-support-bundle",
      stage: "media-probe",
      frame: null,
      durationMs: 12,
      memoryMiB: null,
      concurrency: null,
      cacheReason: null,
      data: { password: "do-not-export", sourceMedia: "assets/private.mov" },
    });
    await expect(
      store.supportBundlePreview({ createdByExplicitAction: false, recordIds: [record.id] }),
    ).rejects.toThrow("explicit user action");
    const exported = await store.exportSupportBundle({
      createdByExplicitAction: true,
      recordIds: [record.id],
    });
    expect(exported.manifest).toMatchObject({
      createdByExplicitAction: true,
      includeSourceMedia: false,
      includeExecutableSource: false,
      includedRecordIds: [record.id],
    });
    const manifest = await readFile(path.join(root, exported.relativePath, "manifest.json"), "utf8");
    expect(manifest).not.toContain("do-not-export");
    expect(manifest).toContain("[REDACTED]");
  });

  it("records crashes locally with telemetry disabled", async () => {
    const root = await temporaryRoot();
    const store = new LocalDiagnosticsStore({ projectRoot: root });
    const crash = await store.recordCrash({
      summary: `Crash near ${root}/scenes/remotion/secret.tsx`,
      correlationId: "correlation-crash-local",
      projectId: "project-crash-local",
      revisionId: "revision-crash-local",
      details: { apiKey: "private-key", upload: "never" },
    });
    expect(crash).toMatchObject({ localOnly: true, telemetryUploaded: false });
    expect(JSON.stringify(crash)).not.toContain("private-key");
    expect(await listLocalCrashRecords(root)).toEqual([`${crash.id}.json`]);
  });
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-local-diagnostics-"));
  roots.push(root);
  return root;
};

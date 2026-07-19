import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtInDeliveryProfiles } from "../../packages/render/src/index.js";
import {
  AssetApiService,
  ProjectSessionService,
  RenderApiService,
  StudioJobRegistry,
} from "../../apps/studio-server/src/index.js";
import { serializeBigInt, type ProjectCommandEnvelope } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("authoritative composition trust in render preflight", () => {
  it("blocks unclassified/imported-disabled sources and permits only exact reviewed promotion", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-security-trust-"));
    temporaryDirectories.push(parent);
    const projects = new ProjectSessionService();
    const jobs = new StudioJobRegistry();
    const assets = new AssetApiService({ projects, jobs });
    const isolationEvidenceHash = "a".repeat(64);
    const renders = new RenderApiService({ projects, jobs, isolationEvidenceHash });
    const projectPath = path.join(parent, "Trust.chai");
    await projects.create({ targetPath: projectPath, title: "Trust", starter: "launch-film" });
    const sourcePath = path.join(projectPath, "assets", "composition.html");
    await writeFile(sourcePath, "<main>trusted only after review</main>");
    let snapshot = await projects.snapshot();
    const imported = await assets.importAsset({
      sourcePath,
      id: "composition-trust-0001",
      kind: "composition",
      rights: "owned",
      context: {
        baseRevisionId: snapshot.pointer.revisionId,
        idempotencyId: "idempotency-security-trust-0001",
        actor: { id: "actor-security-trust-0001", kind: "user", sessionId: "session-security-trust-0001" },
      },
    });
    snapshot = await projects.snapshot();
    const timelineCommand: ProjectCommandEnvelope = {
      schemaVersion: "1.0.0",
      commandId: "command-security-trust-timeline-0001",
      idempotencyId: "idempotency-security-trust-timeline-0001",
      actor: { id: "actor-security-trust-0001", kind: "user", sessionId: "session-security-trust-0001" },
      projectId: snapshot.project.projectId,
      correlationId: "correlation-security-trust-timeline-0001",
      issuedAt: "2026-07-16T11:55:00.000Z",
      capability: { name: "timeline-edit", version: "1.0.0" },
      payloadVersion: "1.0.0",
      affectedEntityIds: [
        snapshot.timeline.timelineId,
        "track-security-trust-video-0001",
        "clip-security-trust-composition-0001",
      ],
      declaredScope: "destructive",
      validationOnly: false,
      baseRevisionId: snapshot.pointer.revisionId,
      authorizationId: "authorization-security-trust-timeline-0001",
      kind: "timeline.replace",
      payload: {
        timeline: {
          ...snapshot.timeline,
          durationFrames: serializeBigInt(30n),
          tracks: [
            {
              id: "track-security-trust-video-0001",
              kind: "video",
              name: "V1",
              order: 0,
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              clips: [
                {
                  id: "clip-security-trust-composition-0001",
                  assetId: imported.asset.id,
                  engine: "remotion",
                  startFrame: serializeBigInt(0n),
                  durationFrames: serializeBigInt(30n),
                  sourceInFrame: serializeBigInt(0n),
                  sourceDurationFrames: serializeBigInt(30n),
                  capability: "native",
                  audioBusId: null,
                  name: "Reviewed composition",
                },
              ],
            },
          ],
        },
      },
    };
    const timelineReceipt = await projects.executeCommand(timelineCommand);
    expect(timelineReceipt, JSON.stringify(timelineReceipt, null, 2)).toMatchObject({
      status: "committed",
    });
    snapshot = await projects.snapshot();
    const profile = builtInDeliveryProfiles()[0];
    if (profile === undefined) throw new Error("Delivery profile missing.");
    const unclassified = await renders.preflight({
      profile,
      scope: { kind: "full-timeline" },
      expectedRevisionId: snapshot.pointer.revisionId,
    });
    expect(unclassified.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "security.trust.unclassified", blocking: true }),
      ]),
    );
    const record = await renders.classifyComposition({
      compositionId: imported.asset.id,
      sourceHash: imported.asset.contentHash,
      trustClass: "imported_untrusted",
      classifiedBy: "actor-security-trust-0001",
    });
    const importedPreflight = await renders.preflight({
      profile,
      scope: { kind: "full-timeline" },
      expectedRevisionId: snapshot.pointer.revisionId,
    });
    expect(importedPreflight.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "security.imported-execution.disabled", blocking: true }),
      ]),
    );
    const promoted = await renders.promoteComposition({
      schemaVersion: "1.0.0",
      id: "review-security-trust-0001",
      compositionId: record.compositionId,
      sourceHash: record.sourceHash,
      reviewerId: "reviewer-security-trust-0001",
      decision: "approved",
      checklist: ["source reviewed", "network reviewed", "filesystem reviewed", "behavior reviewed"],
      reviewedAt: "2026-07-16T12:00:00.000Z",
    });
    expect(promoted).toMatchObject({ trustClass: "trusted_authored" });
    const reviewed = await renders.preflight({
      profile,
      scope: { kind: "full-timeline" },
      expectedRevisionId: snapshot.pointer.revisionId,
    });
    expect(reviewed.security).toMatchObject({
      trustClasses: ["trusted_authored"],
      trustRecords: [expect.objectContaining({ promotionReviewId: "review-security-trust-0001" })],
      isolationEvidenceHash,
    });
    expect(reviewed.findings.some((finding) => finding.code.startsWith("security."))).toBe(false);
  });
});

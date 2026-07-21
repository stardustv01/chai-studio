import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { centralizedQaRules, createQaReport, qaRuleSetIdentity } from "../../packages/qa/src/index.js";
import { StudioJobRegistry } from "../../apps/studio-server/src/job-registry.js";
import { ProjectSessionService } from "../../apps/studio-server/src/project-service.js";
import { RenderApiService } from "../../apps/studio-server/src/render-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authoritative QA lifecycle service", () => {
  it("rejects generic-command and state-skip bypasses while allowing evidence-backed transitions", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-qa-authority-"));
    roots.push(parent);
    const service = new ProjectSessionService({ now: advancingClock() });
    await service.create({ targetPath: path.join(parent, "Authority.chai"), title: "Authority" });
    let snapshot = await service.snapshot();

    await expect(
      service.executeCommand({ kind: "lifecycle.transition", payload: { to: "approved" } }),
    ).rejects.toThrow(/authoritative QA lifecycle service/i);

    const outputId = "output-authority-0001";
    await service.transitionQaLifecycle({
      outputId,
      to: "rendered_unchecked",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report: null,
      exceptions: [],
      evidenceHashes: ["a".repeat(64)],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    expect(snapshot.approvalState).toMatchObject({ outputId, state: "rendered_unchecked" });

    await expect(
      service.transitionQaLifecycle({
        outputId,
        to: "approved",
        actor,
        expectedRevisionId: snapshot.pointer.revisionId,
        report: null,
        exceptions: [],
        evidenceHashes: ["b".repeat(64)],
        exceptionIds: [],
      }),
    ).rejects.toThrow(/forbidden/i);

    const report = createQaReport({
      id: "qa-report-authority-0001",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      outputId,
      ruleSetIdentity: qaRuleSetIdentity(),
      rules: centralizedQaRules().map(({ id, version }) => ({ id, version })),
      findings: [],
      createdAt: "2026-07-16T12:00:00.000Z",
    });
    await service.transitionQaLifecycle({
      outputId,
      to: "qa_passed",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report,
      exceptions: [],
      evidenceHashes: [report.identityHash],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    const nextOutputId = "output-authority-0002";
    await service.transitionQaLifecycle({
      outputId: nextOutputId,
      to: "rendered_unchecked",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report: null,
      exceptions: [],
      evidenceHashes: ["c".repeat(64)],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    const nextReport = createQaReport({
      id: "qa-report-authority-0002",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      outputId: nextOutputId,
      ruleSetIdentity: qaRuleSetIdentity(),
      rules: centralizedQaRules().map(({ id, version }) => ({ id, version })),
      findings: [],
      createdAt: "2026-07-16T12:01:00.000Z",
    });
    await service.transitionQaLifecycle({
      outputId: nextOutputId,
      to: "qa_passed",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report: nextReport,
      exceptions: [],
      evidenceHashes: [nextReport.identityHash],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    const renders = new RenderApiService({ projects: service, jobs: new StudioJobRegistry() });
    await expect(
      renders.approve({
        outputId,
        actor,
        expectedRevisionId: snapshot.pointer.revisionId,
        evidenceHashes: [report.identityHash],
        exceptionIds: [],
      }),
    ).rejects.toThrow(/current immutable output identity/i);

    await service.transitionQaLifecycle({
      outputId: nextOutputId,
      to: "approved",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report: nextReport,
      exceptions: [],
      evidenceHashes: [nextReport.identityHash],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    await service.transitionQaLifecycle({
      outputId: nextOutputId,
      to: "delivered",
      actor,
      expectedRevisionId: snapshot.pointer.revisionId,
      report: nextReport,
      exceptions: [],
      evidenceHashes: [nextReport.identityHash],
      exceptionIds: [],
    });
    snapshot = await service.snapshot();
    expect(snapshot.approvalState).toMatchObject({ state: "delivered", outputId: nextOutputId });

    await expect(
      service.transitionQaLifecycle({
        outputId: nextOutputId,
        to: "rendered_unchecked",
        actor,
        expectedRevisionId: snapshot.pointer.revisionId,
        report: null,
        exceptions: [],
        evidenceHashes: ["d".repeat(64)],
        exceptionIds: [],
      }),
    ).rejects.toThrow(/new immutable output identity/i);
  });
});

const actor = {
  id: "actor-qa-authority-0001",
  kind: "user" as const,
  sessionId: "session-qa-authority-0001",
};

const advancingClock = () => {
  let tick = 0;
  return (): Date => {
    tick += 1;
    return new Date(Date.UTC(2026, 6, 16, 12, 0, tick));
  };
};

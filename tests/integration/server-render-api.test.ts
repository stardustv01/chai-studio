import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRenderEnvironmentIdentity,
  builtInDeliveryProfiles,
  createRenderPlan,
  mergeRenderDependencies,
  RenderRecoveryJournalStore,
  type RenderPlan,
} from "../../packages/render/src/index.js";
import { normalizeRational, stringifyCanonicalJson } from "../../packages/schema/src/index.js";
import { evaluateAudioMeasurements, evaluateStructuralOutput } from "../../packages/qa/src/index.js";
import {
  ProjectSessionService,
  RenderApiService,
  StudioJobRegistry,
  createStudioServer,
  renderAudioEvidenceFromMixArtifact,
  type ApiSuccessEnvelope,
  type QaWorkspaceView,
  type QaEvaluator,
  type RenderOutputRecord,
  type RenderReceiptBase,
  type RenderReceiptView,
  type RenderRequestRecord,
  type StudioJobSnapshot,
} from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];
const openServers: ReturnType<typeof createStudioServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("render HTTP API", () => {
  it("persists custom profiles and restart-safe queue authority while clearing only queue history", async () => {
    const fixture = await serverFixture(async (input) => {
      const audioContent = "restart-safe-audio";
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "restart.mp4"), "restart-safe-output"),
        writeFile(path.join(input.outputDirectory, "restart.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "restart.mp4",
        additionalRelativePaths: ["restart.wav"],
        engines: [{ engine: "shared" as const, version: "fixture-1", role: "finishing" }],
        cacheLineage: ["cache-entry-restart-safe"],
        warnings: [],
        reproductionCommands: ["fixture-restart-safe"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const snapshot = await fixture.projects.snapshot();
    const builtInProfile = builtInDeliveryProfiles()[0];
    if (builtInProfile === undefined) throw new Error("Built-in delivery fixture is missing.");
    const { schemaVersion: _schemaVersion, identityHash: _identityHash, ...seed } = builtInProfile;
    void _schemaVersion;
    void _identityHash;
    const customResponse = await fixture.request("/api/v1/renders/profiles", {
      method: "POST",
      body: JSON.stringify({
        profile: {
          ...seed,
          id: "profile-custom-restart-safe",
          name: "Restart-safe custom",
          kind: "custom",
        },
      }),
    });
    expect(customResponse.status).toBe(201);
    const custom = (await customResponse.json()) as ApiSuccessEnvelope<
      ReturnType<typeof builtInDeliveryProfiles>[number]
    >;
    expect(custom.data).toMatchObject({ kind: "custom", name: "Restart-safe custom" });
    expect(custom.data.identityHash).toMatch(/^[a-f0-9]{64}$/);

    const preflight = await fixture.request("/api/v1/renders/preflight", {
      method: "POST",
      body: JSON.stringify({
        profile: custom.data,
        scope: { kind: "full-timeline" },
        expectedRevisionId: snapshot.pointer.revisionId,
      }),
    });
    expect((await preflight.json()) as ApiSuccessEnvelope<{ executable: boolean }>).toMatchObject({
      data: { executable: true },
    });

    const queued = (
      (await (
        await fixture.request("/api/v1/renders", {
          method: "POST",
          body: JSON.stringify({
            ...renderBody(snapshot.pointer.revisionId),
            profile: custom.data,
            name: "Restart-safe render",
          }),
        })
      ).json()) as ApiSuccessEnvelope<{ request: RenderRequestRecord; job: StudioJobSnapshot }>
    ).data;
    expect(await fixture.jobs.wait(queued.job.id)).toMatchObject({ status: "completed" });
    await fixture.render.queue();

    const restarted = new RenderApiService({ projects: fixture.projects, jobs: new StudioJobRegistry() });
    expect(await restarted.requests()).toHaveLength(1);
    expect(await restarted.queue()).toMatchObject([
      {
        request: { id: queued.request.id, name: "Restart-safe render" },
        job: null,
        persistedStatus: "completed",
        cacheHits: 1,
        qaState: "rendered_unchecked",
      },
    ]);
    expect(await restarted.clearCompleted()).toEqual({ removed: 1 });
    expect(await restarted.requests()).toHaveLength(0);
    expect(await restarted.outputs()).toHaveLength(1);
  });

  it("rejects security evidence bound to a different strict render environment", async () => {
    const fixture = await serverFixture(async (input) => {
      const audioContent = "mismatched-environment-audio";
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "mismatch.mp4"), "mismatched-environment-output"),
        writeFile(path.join(input.outputDirectory, "mismatch.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "mismatch.mp4",
        additionalRelativePaths: ["mismatch.wav"],
        engines: [{ engine: "shared" as const, version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-mismatched-environment"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: { ...fixtureSecurity(input.request), environmentIdentity: "0".repeat(64) },
      };
    });
    const snapshot = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue(renderBody(snapshot.pointer.revisionId));
    const failed = await fixture.jobs.wait(queued.job.id);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.error).toMatch(/security evidence is invalid/i);
    expect(await fixture.render.outputs()).toEqual([]);
  });

  it("queues output, records immutable receipt identity, runs QA, and explicitly approves", async () => {
    const fixture = await serverFixture((input) => {
      input.report(0.5);
      const audioContent = "authoritative-audio";
      return Promise.all([
        writeFile(path.join(input.outputDirectory, "master.mp4"), "rendered-output"),
        writeFile(path.join(input.outputDirectory, "program-audio.wav"), audioContent),
      ]).then(() => ({
        primaryRelativePath: "master.mp4",
        additionalRelativePaths: ["program-audio.wav"],
        engines: [{ engine: "shared" as const, version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: ["P07 fixture executor"],
        reproductionCommands: ["fixture-render"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      }));
    });
    const snapshot = await fixture.projects.snapshot();
    const queuedResponse = await fixture.request("/api/v1/renders", {
      method: "POST",
      body: JSON.stringify(renderBody(snapshot.pointer.revisionId)),
    });
    expect(queuedResponse.status).toBe(202);
    const queued = (
      (await queuedResponse.json()) as ApiSuccessEnvelope<{
        request: RenderRequestRecord;
        job: StudioJobSnapshot;
      }>
    ).data;
    const completed = await fixture.jobs.wait(queued.job.id);
    expect(completed, completed.error ?? "render failed").toMatchObject({ status: "completed" });
    const output = completed.result as RenderOutputRecord;
    expect(output).toMatchObject({
      lifecycleState: "rendered_unchecked",
      sourceRevisionId: snapshot.pointer.revisionId,
    });

    let current = await fixture.projects.snapshot();
    expect(current.approvalState).toMatchObject({ state: "rendered_unchecked", outputId: output.id });
    const baseReceipt = await fixture.request(`/api/v1/renders/outputs/${output.id}/receipt`);
    expect((await baseReceipt.json()) as ApiSuccessEnvelope<RenderReceiptView>).toMatchObject({
      data: {
        base: {
          identityHash: output.receiptIdentityHash,
          receiptVersion: "1.0.0",
          environment: { status: "recorded" },
          dependencies: { status: "recorded" },
          security: {
            trustClasses: ["trusted_authored"],
            workerPoolIds: ["trusted-worker-fixture-v1"],
            cacheNamespaces: ["trusted-cache-fixture-v1"],
            violations: [],
          },
          preflight: { status: "passed" },
          audio: {
            status: "measured",
            measurementVersion: "chai-audio-measurements-v1",
            integratedLufs: -16,
            clippedSampleCount: 0,
          },
          approval: null,
          delivered: false,
        },
        currentState: "rendered_unchecked",
        lifecycle: [{ to: "rendered_unchecked" }],
      },
    });

    const qaResponse = await fixture.request(`/api/v1/renders/outputs/${output.id}/qa`, {
      method: "POST",
      body: JSON.stringify({ actor: actor(), expectedRevisionId: current.pointer.revisionId }),
    });
    expect(qaResponse.status).toBe(202);
    const qaJob = ((await qaResponse.json()) as ApiSuccessEnvelope<StudioJobSnapshot>).data;
    expect(await fixture.jobs.wait(qaJob.id)).toMatchObject({
      status: "completed",
      result: {
        result: { audio: { status: "passed", measurements: { integratedLufs: -16 } } },
        report: { audio: { measurementVersion: "chai-audio-measurements-v1" } },
      },
    });
    current = await fixture.projects.snapshot();
    expect(current.approvalState.state).toBe("qa_passed");

    const workspace = (
      (await (
        await fixture.request(`/api/v1/renders/outputs/${output.id}/qa`)
      ).json()) as ApiSuccessEnvelope<QaWorkspaceView>
    ).data;
    expect(workspace.rules).toHaveLength(22);
    expect(workspace.latest?.authoritativeReport.findings.map((finding) => finding.ruleId)).toEqual([
      "qa.post.structure",
      "qa.post.audio",
    ]);
    expect(workspace.checklist?.items).toHaveLength(10);
    for (const item of workspace.checklist?.items ?? []) {
      const recorded = await fixture.request(`/api/v1/renders/outputs/${output.id}/qa/checklist/${item.id}`, {
        method: "POST",
        body: JSON.stringify({
          status: "passed",
          reviewerId: "actor-render-api-0001",
          evidenceHashes: [createHash("sha256").update(item.id).digest("hex")],
        }),
      });
      expect(recorded.status).toBe(200);
    }

    const approved = await fixture.request(`/api/v1/renders/outputs/${output.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        actor: actor(),
        expectedRevisionId: current.pointer.revisionId,
        evidenceHashes: ["a".repeat(64)],
        exceptionIds: [],
      }),
    });
    expect(approved.status).toBe(200);
    const receipt = await fixture.render.receipt(output.id);
    expect(receipt.currentState).toBe("approved");
    expect(receipt.checklist?.complete).toBe(true);
    expect(receipt.qaReports).toHaveLength(1);
    expect(receipt.lifecycle.map((event) => event.to)).toEqual([
      "rendered_unchecked",
      "qa_passed",
      "approved",
    ]);
    expect(new Set(receipt.lifecycle.map((event) => event.eventHash)).size).toBe(3);

    current = await fixture.projects.snapshot();
    const delivered = await fixture.request(`/api/v1/renders/outputs/${output.id}/deliver`, {
      method: "POST",
      body: JSON.stringify({
        actor: actor(),
        expectedRevisionId: current.pointer.revisionId,
        evidenceHashes: ["d".repeat(64)],
      }),
    });
    expect(delivered.status).toBe(200);
    expect((await fixture.render.receipt(output.id)).currentState).toBe("delivered");
  });

  it("writes measured audio into QA evidence and fails clipped authoritative mixes", async () => {
    const fixture = await serverFixture(async (input) => {
      const audioContent = "clipped-authoritative-audio";
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "clipped.mp4"), "clipped-render"),
        writeFile(path.join(input.outputDirectory, "clipped-audio.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "clipped.mp4",
        additionalRelativePaths: ["clipped-audio.wav"],
        engines: [{ engine: "shared" as const, version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-clipped-render"],
        audio: {
          ...audioEvidence(audioContent),
          truePeakDbtp: 0.25,
          clippedSampleCount: 1,
        },
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const snapshot = await fixture.projects.snapshot();
    const queued = (
      (await (
        await fixture.request("/api/v1/renders", {
          method: "POST",
          body: JSON.stringify(renderBody(snapshot.pointer.revisionId)),
        })
      ).json()) as ApiSuccessEnvelope<{ request: RenderRequestRecord; job: StudioJobSnapshot }>
    ).data;
    const completed = await fixture.jobs.wait(queued.job.id);
    expect(completed.status).toBe("completed");
    const output = completed.result as RenderOutputRecord;
    const current = await fixture.projects.snapshot();
    const qaJob = (
      (await (
        await fixture.request(`/api/v1/renders/outputs/${output.id}/qa`, {
          method: "POST",
          body: JSON.stringify({ actor: actor(), expectedRevisionId: current.pointer.revisionId }),
        })
      ).json()) as ApiSuccessEnvelope<StudioJobSnapshot>
    ).data;
    expect(await fixture.jobs.wait(qaJob.id)).toMatchObject({
      status: "completed",
      result: {
        result: {
          state: "qa_failed",
          audio: {
            status: "failed",
            measurements: { clippedSampleCount: 1, truePeakDbtp: 0.25 },
          },
        },
      },
    });
    expect((await fixture.projects.snapshot()).approvalState.state).toBe("qa_failed");
  });

  it("cancels a running render and retries the exact source revision as a new attempt", async () => {
    let invocation = 0;
    let observedResume: Parameters<
      NonNullable<ConstructorParameters<typeof RenderApiService>[0]["executeRender"]>
    >[0]["resume"] = null;
    let started = (): void => {
      throw new Error("Render did not start.");
    };
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fixture = await serverFixture(async (input) => {
      invocation += 1;
      if (invocation === 1) {
        started();
        await new Promise<void>((_, reject) => {
          input.signal.addEventListener(
            "abort",
            () => {
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        });
      }
      observedResume = input.resume;
      await writeFile(path.join(input.outputDirectory, "retry.mp4"), "retry-output");
      const audioContent = "retry-authoritative-audio";
      await writeFile(path.join(input.outputDirectory, "retry-audio.wav"), audioContent);
      return {
        primaryRelativePath: "retry.mp4",
        additionalRelativePaths: ["retry-audio.wav"],
        engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-retry"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const snapshot = await fixture.projects.snapshot();
    const queued = (
      (await (
        await fixture.request("/api/v1/renders", {
          method: "POST",
          body: JSON.stringify(renderBody(snapshot.pointer.revisionId)),
        })
      ).json()) as ApiSuccessEnvelope<{ request: RenderRequestRecord; job: StudioJobSnapshot }>
    ).data;
    await began;
    const cancelled = await fixture.request(`/api/v1/renders/jobs/${queued.job.id}/cancel`, {
      method: "POST",
    });
    expect((await cancelled.json()) as ApiSuccessEnvelope<StudioJobSnapshot>).toMatchObject({
      data: { status: "cancelled" },
    });
    const retriedResponse = await fixture.request(`/api/v1/renders/jobs/${queued.job.id}/retry`, {
      method: "POST",
    });
    expect(retriedResponse.status).toBe(202);
    const retried = (
      (await retriedResponse.json()) as ApiSuccessEnvelope<{
        request: RenderRequestRecord;
        job: StudioJobSnapshot;
      }>
    ).data;
    expect(retried.request).toMatchObject({ attempt: 2, retryOfRequestId: queued.request.id });
    expect(await fixture.jobs.wait(retried.job.id)).toMatchObject({ status: "completed" });
    expect(observedResume).toMatchObject({
      priorRequestId: queued.request.id,
      completedStages: ["request-persisted", "operation-started"],
      validatedArtifacts: [],
    });
    const root = fixture.projects.openRootPath();
    expect(await new RenderRecoveryJournalStore(root).read(queued.request.id)).toMatchObject({
      status: "cancelled",
      partialOutputRetained: true,
      lastError: "cancelled",
    });
  });

  it("fails closed when persisted output, receipt, QA, delivery, or job records are malformed", async () => {
    const fixture = await serverFixture(async (input) => {
      const audioContent = "persistence-validation-audio";
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "validated.mp4"), "validated-output"),
        writeFile(path.join(input.outputDirectory, "validated.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "validated.mp4",
        additionalRelativePaths: ["validated.wav"],
        engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-persistence-validation"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-persistence-validation-0001",
    });
    const completed = await fixture.jobs.wait(queued.job.id);
    expect(completed.status).toBe("completed");
    const output = completed.result as RenderOutputRecord;
    const root = fixture.projects.openRootPath();

    const outputPath = path.join(root, "renders", output.id, "output.json");
    const outputSource = await readFile(outputPath, "utf8");
    await writeFile(outputPath, JSON.stringify({ ...JSON.parse(outputSource), id: "output-tampered" }));
    await expect(fixture.render.outputs()).rejects.toThrow(/persisted render output/i);
    await writeFile(outputPath, outputSource);

    const alternateProfile = builtInDeliveryProfiles().find((profile) => profile.id !== output.profile.id);
    if (alternateProfile === undefined) throw new Error("Alternate delivery profile fixture is missing.");
    await writeFile(
      outputPath,
      JSON.stringify({
        ...JSON.parse(outputSource),
        activationRevisionId: "revision-tampered-activation-0001",
        profile: alternateProfile,
      }),
    );
    await expect(fixture.render.outputs()).rejects.toThrow(/does not match its immutable receipt/i);
    await writeFile(outputPath, outputSource);

    const receiptPath = path.join(root, "receipts", "renders", output.id, "render.json");
    const receiptSource = await readFile(receiptPath, "utf8");
    await writeFile(
      receiptPath,
      JSON.stringify({ ...JSON.parse(receiptSource), identityHash: "0".repeat(64) }),
    );
    await expect(fixture.render.receipt(output.id)).rejects.toThrow(/invalid identity/i);
    await writeFile(receiptPath, receiptSource);

    const lifecycleDirectory = path.join(root, "receipts", "renders", output.id, "lifecycle");
    const lifecycleName = (await readdir(lifecycleDirectory)).find((name) => name.endsWith(".json"));
    if (lifecycleName === undefined) throw new Error("Lifecycle persistence fixture is missing.");
    const lifecyclePath = path.join(lifecycleDirectory, lifecycleName);
    const lifecycleSource = await readFile(lifecyclePath, "utf8");
    const { eventHash: _eventHash, ...tamperedLifecycle } = JSON.parse(lifecycleSource) as Record<
      string,
      unknown
    >;
    void _eventHash;
    tamperedLifecycle.actor = {
      id: "actor-tampered-lifecycle-0001",
      kind: "user",
      sessionId: "session-tampered-lifecycle-0001",
    };
    await writeFile(
      lifecyclePath,
      stringifyCanonicalJson({
        ...tamperedLifecycle,
        eventHash: createHash("sha256")
          .update(stringifyCanonicalJson(tamperedLifecycle), "utf8")
          .digest("hex"),
      }),
    );
    await expect(fixture.render.receipt(output.id)).rejects.toThrow(/immutable revision evidence/i);
    await writeFile(lifecyclePath, lifecycleSource);

    await fixture.render.queue();
    const jobPath = path.join(root, "renders", "queue", "jobs", `${queued.job.id}.json`);
    const jobSource = await readFile(jobPath, "utf8");
    await writeFile(jobPath, JSON.stringify({ ...JSON.parse(jobSource), progress: 2 }));
    const restarted = new RenderApiService({ projects: fixture.projects, jobs: new StudioJobRegistry() });
    await expect(restarted.queue()).rejects.toThrow(/persisted Studio job/i);
    await writeFile(jobPath, jobSource);

    let current = await fixture.projects.snapshot();
    const qaJob = await fixture.render.enqueueQa({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      correlationId: "correlation-persistence-validation-qa",
    });
    expect(await fixture.jobs.wait(qaJob.id)).toMatchObject({ status: "completed" });
    const qaDirectory = path.join(root, "receipts", "renders", output.id, "qa");
    const qaName = (await readdir(qaDirectory)).find(
      (name) => name.endsWith(".json") && name !== "checklist.json",
    );
    if (qaName === undefined) throw new Error("QA persistence fixture is missing.");
    const qaPath = path.join(qaDirectory, qaName);
    const qaSource = await readFile(qaPath, "utf8");
    await writeFile(qaPath, JSON.stringify({ ...JSON.parse(qaSource), reportHash: "f".repeat(64) }));
    await expect(fixture.render.qaWorkspace(output.id)).rejects.toThrow(/QA receipt.*invalid identity/i);
    await writeFile(qaPath, qaSource);

    const checklist = (await fixture.render.qaWorkspace(output.id)).checklist;
    if (checklist === null) throw new Error("Review checklist fixture is missing.");
    for (const item of checklist.items) {
      await fixture.render.recordChecklistItem({
        outputId: output.id,
        itemId: item.id,
        status: "passed",
        reviewerId: "actor-persistence-validation",
        evidenceHashes: [createHash("sha256").update(item.id).digest("hex")],
      });
    }
    current = await fixture.projects.snapshot();
    await fixture.render.approve({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      evidenceHashes: ["a".repeat(64)],
      exceptionIds: [],
    });
    current = await fixture.projects.snapshot();
    await fixture.render.deliver({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      evidenceHashes: ["d".repeat(64)],
    });
    const deliveryPath = path.join(root, "receipts", "renders", output.id, "delivery.json");
    const deliverySource = await readFile(deliveryPath, "utf8");
    await writeFile(
      deliveryPath,
      JSON.stringify({ ...JSON.parse(deliverySource), lifecycleEventHash: "e".repeat(64) }),
    );
    await expect(fixture.render.receipt(output.id)).rejects.toThrow(/does not match.*lifecycle event/i);
  });

  it("recovers lifecycle evidence after a revision commit is interrupted before event publication", async () => {
    let inject = true;
    const fixture = await serverFixture(
      async (input) => {
        const audioContent = "journal-recovery-audio";
        await Promise.all([
          writeFile(path.join(input.outputDirectory, "recover.mp4"), "recover-output"),
          writeFile(path.join(input.outputDirectory, "recover.wav"), audioContent),
        ]);
        return {
          primaryRelativePath: "recover.mp4",
          additionalRelativePaths: ["recover.wav"],
          engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
          cacheLineage: [],
          warnings: [],
          reproductionCommands: ["fixture-journal-recovery"],
          audio: audioEvidence(audioContent),
          plan: fixturePlan(input.request),
          security: fixtureSecurity(input.request),
        };
      },
      {
        checkpoint: (point) => {
          if (inject && point === "lifecycle-revision-committed") {
            inject = false;
            throw new Error("simulated lifecycle publication interruption");
          }
        },
      },
    );
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-lifecycle-journal-recovery",
    });
    expect(await fixture.jobs.wait(queued.job.id)).toMatchObject({ status: "failed" });
    const recovery = await new RenderRecoveryJournalStore(fixture.projects.openRootPath()).read(
      queued.request.id,
    );
    const outputId = recovery?.outputId;
    if (outputId === null || outputId === undefined) throw new Error("Recovery output identity is missing.");
    expect((await fixture.projects.snapshot()).approvalState).toMatchObject({
      outputId,
      state: "rendered_unchecked",
    });

    const restarted = new RenderApiService({ projects: fixture.projects, jobs: new StudioJobRegistry() });
    await expect(restarted.outputs()).resolves.toMatchObject([
      { id: outputId, lifecycleState: "rendered_unchecked" },
    ]);
    const recoveredOutput = JSON.parse(
      await readFile(path.join(fixture.projects.openRootPath(), "renders", outputId, "output.json"), "utf8"),
    ) as { readonly id: string };
    expect(recoveredOutput.id).toBe(outputId);
    await expect(restarted.receipt(outputId)).resolves.toMatchObject({
      currentState: "rendered_unchecked",
      lifecycle: [{ outputId, to: "rendered_unchecked" }],
    });
    const pending = await readdir(
      path.join(fixture.projects.openRootPath(), "receipts", "renders", outputId, "transactions"),
    );
    expect(pending.filter((name) => name.endsWith(".json"))).toEqual([]);
  });

  it("keeps a second output receipt readable when activation starts from prior global lifecycle state", async () => {
    const fixture = await serverFixture(async (input) => {
      const audioContent = `second-output-audio-${input.outputId}`;
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "second.mp4"), `output-${input.outputId}`),
        writeFile(path.join(input.outputDirectory, "second.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "second.mp4",
        additionalRelativePaths: ["second.wav"],
        engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-second-output"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const initial = await fixture.projects.snapshot();
    const first = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-second-output-first",
    });
    const firstCompleted = await fixture.jobs.wait(first.job.id);
    expect(firstCompleted.status).toBe("completed");
    const current = await fixture.projects.snapshot();
    const second = await fixture.render.enqueue({
      ...renderBody(current.pointer.revisionId),
      correlationId: "correlation-second-output-second",
    });
    const secondCompleted = await fixture.jobs.wait(second.job.id);
    expect(secondCompleted.status).toBe("completed");
    const secondOutput = secondCompleted.result as RenderOutputRecord;
    await expect(fixture.render.receipt(secondOutput.id)).resolves.toMatchObject({
      currentState: "rendered_unchecked",
      lifecycle: [{ from: "rendered_unchecked", to: "rendered_unchecked" }],
    });
    await expect(fixture.render.outputs()).resolves.toHaveLength(2);
  });

  it.each(["receipt-write", "approval-transition"] as const)(
    "ignores an incomplete output interrupted at %s when no activation revision committed",
    async (faultPoint) => {
      let inject = true;
      const fixture = await serverFixture(persistenceExecutor(`incomplete-${faultPoint}`), {
        checkpoint: (point) => {
          if (inject && point === faultPoint) {
            inject = false;
            throw new Error(`simulated ${faultPoint} interruption`);
          }
        },
      });
      const initial = await fixture.projects.snapshot();
      const queued = await fixture.render.enqueue({
        ...renderBody(initial.pointer.revisionId),
        correlationId: `correlation-incomplete-${faultPoint}`,
      });
      expect(await fixture.jobs.wait(queued.job.id)).toMatchObject({ status: "failed" });
      const recovery = await new RenderRecoveryJournalStore(fixture.projects.openRootPath()).read(
        queued.request.id,
      );
      const outputId = recovery?.outputId;
      if (outputId === null || outputId === undefined) throw new Error("Incomplete output ID is missing.");
      expect((await fixture.projects.snapshot()).approvalState.outputId).not.toBe(outputId);
      const restarted = new RenderApiService({ projects: fixture.projects, jobs: new StudioJobRegistry() });
      await expect(restarted.outputs()).resolves.toEqual([]);
      await expect(restarted.receipt(outputId)).rejects.toThrow(/lacks activation evidence/i);
    },
  );

  it("cleans an uncommitted lifecycle intent when a concurrent revision advances its source", async () => {
    const projectRef: { current: ProjectSessionService | null } = { current: null };
    let advance = true;
    const fixture = await serverFixture(persistenceExecutor("concurrent-intent"), {
      checkpoint: async (point) => {
        if (!advance || point !== "lifecycle-intent-written") return;
        advance = false;
        if (projectRef.current === null) throw new Error("Concurrent project fixture is unavailable.");
        const current = await projectRef.current.snapshot();
        await projectRef.current.transitionQaLifecycle({
          outputId: "output-concurrent-authority-0001",
          to: "rendered_unchecked",
          actor: actor(),
          expectedRevisionId: current.pointer.revisionId,
          report: null,
          exceptions: [],
          evidenceHashes: ["c".repeat(64)],
          exceptionIds: [],
        });
      },
    });
    projectRef.current = fixture.projects;
    const projects = fixture.projects;
    const initial = await projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-concurrent-intent",
    });
    expect(await fixture.jobs.wait(queued.job.id)).toMatchObject({ status: "failed" });
    const recovery = await new RenderRecoveryJournalStore(projects.openRootPath()).read(queued.request.id);
    const outputId = recovery?.outputId;
    if (outputId === null || outputId === undefined) throw new Error("Concurrent output ID is missing.");
    const transactionDirectory = path.join(
      projects.openRootPath(),
      "receipts",
      "renders",
      outputId,
      "transactions",
    );
    expect((await readdir(transactionDirectory)).filter((name) => name.endsWith(".json"))).toEqual([]);
    const restarted = new RenderApiService({ projects, jobs: new StudioJobRegistry() });
    await expect(restarted.outputs()).resolves.toEqual([]);
  });

  it("orders same-timestamp lifecycle evidence by immutable revision ancestry, not filenames", async () => {
    const fixture = await serverFixture(persistenceExecutor("ancestry-order"));
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-ancestry-order-render",
    });
    const completed = await fixture.jobs.wait(queued.job.id);
    expect(completed.status).toBe("completed");
    const output = completed.result as RenderOutputRecord;
    const current = await fixture.projects.snapshot();
    const qaJob = await fixture.render.enqueueQa({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      correlationId: "correlation-ancestry-order-qa",
    });
    expect(await fixture.jobs.wait(qaJob.id)).toMatchObject({ status: "completed" });
    const lifecycleDirectory = path.join(
      fixture.projects.openRootPath(),
      "receipts",
      "renders",
      output.id,
      "lifecycle",
    );
    for (const name of await readdir(lifecycleDirectory)) {
      const event = JSON.parse(await readFile(path.join(lifecycleDirectory, name), "utf8")) as {
        readonly to: string;
      };
      await rename(
        path.join(lifecycleDirectory, name),
        path.join(lifecycleDirectory, event.to === "rendered_unchecked" ? "z-activation.json" : "a-qa.json"),
      );
    }
    await expect(fixture.render.receipt(output.id)).resolves.toMatchObject({
      lifecycle: [{ to: "rendered_unchecked" }, { to: "qa_passed" }],
      currentState: "qa_passed",
    });
  });

  it("ignores an orphan QA report after a pre-commit crash and binds the successful rerun", async () => {
    let lifecycleIntentCount = 0;
    const fixture = await serverFixture(persistenceExecutor("orphan-qa"), {
      checkpoint: (point) => {
        if (point === "lifecycle-intent-written") {
          lifecycleIntentCount += 1;
          if (lifecycleIntentCount === 2) throw new Error("simulated QA lifecycle pre-commit crash");
        }
      },
    });
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-orphan-qa-render",
    });
    const completed = await fixture.jobs.wait(queued.job.id);
    expect(completed.status).toBe("completed");
    const output = completed.result as RenderOutputRecord;
    let current = await fixture.projects.snapshot();
    const failedQa = await fixture.render.enqueueQa({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      correlationId: "correlation-orphan-qa-failed",
    });
    expect(await fixture.jobs.wait(failedQa.id)).toMatchObject({ status: "failed" });
    await expect(fixture.render.qaWorkspace(output.id)).resolves.toMatchObject({
      reports: [],
      latest: null,
    });
    current = await fixture.projects.snapshot();
    const successfulQa = await fixture.render.enqueueQa({
      outputId: output.id,
      actor: actor(),
      expectedRevisionId: current.pointer.revisionId,
      correlationId: "correlation-orphan-qa-success",
    });
    expect(await fixture.jobs.wait(successfulQa.id)).toMatchObject({ status: "completed" });
    await expect(fixture.render.qaWorkspace(output.id)).resolves.toMatchObject({
      reports: [{ state: "qa_passed" }],
      latest: { state: "qa_passed" },
    });
  });

  it("rejects any reported render security violation", async () => {
    const baseExecutor = persistenceExecutor("security-violation");
    const fixture = await serverFixture(async (input) => {
      const result = await baseExecutor(input);
      return { ...result, security: { ...result.security, violations: ["sandbox escape observed"] } };
    });
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-security-violation",
    });
    const failed = await fixture.jobs.wait(queued.job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/security evidence is invalid/i);
    await expect(fixture.render.outputs()).resolves.toEqual([]);
  });

  it("holds a project operation lease for queued and running render work", async () => {
    let releaseRender = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const fixture = await serverFixture(async (input) => {
      await blocked;
      const audioContent = "leased-render-audio";
      await Promise.all([
        writeFile(path.join(input.outputDirectory, "leased.mp4"), "leased-output"),
        writeFile(path.join(input.outputDirectory, "leased.wav"), audioContent),
      ]);
      return {
        primaryRelativePath: "leased.mp4",
        additionalRelativePaths: ["leased.wav"],
        engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
        cacheLineage: [],
        warnings: [],
        reproductionCommands: ["fixture-operation-lease"],
        audio: audioEvidence(audioContent),
        plan: fixturePlan(input.request),
        security: fixtureSecurity(input.request),
      };
    });
    const initial = await fixture.projects.snapshot();
    const queued = await fixture.render.enqueue({
      ...renderBody(initial.pointer.revisionId),
      correlationId: "correlation-operation-lease-0001",
    });
    await expect(fixture.projects.close()).rejects.toThrow(/operation lease/i);
    releaseRender();
    expect(await fixture.jobs.wait(queued.job.id)).toMatchObject({ status: "completed" });
    await expect(fixture.projects.close()).resolves.toMatchObject({ closed: true });
  });
});

const persistenceExecutor =
  (label: string): NonNullable<ConstructorParameters<typeof RenderApiService>[0]["executeRender"]> =>
  async (input) => {
    const audioContent = `${label}-audio`;
    await Promise.all([
      writeFile(path.join(input.outputDirectory, `${label}.mp4`), `${label}-output`),
      writeFile(path.join(input.outputDirectory, `${label}.wav`), audioContent),
    ]);
    return {
      primaryRelativePath: `${label}.mp4`,
      additionalRelativePaths: [`${label}.wav`],
      engines: [{ engine: "shared", version: "fixture-1", role: "finishing" }],
      cacheLineage: [],
      warnings: [],
      reproductionCommands: [`fixture-${label}`],
      audio: audioEvidence(audioContent),
      plan: fixturePlan(input.request),
      security: fixtureSecurity(input.request),
    };
  };

const serverFixture = async (
  executeRender: NonNullable<ConstructorParameters<typeof RenderApiService>[0]["executeRender"]>,
  options: Readonly<{
    checkpoint?: NonNullable<ConstructorParameters<typeof RenderApiService>[0]["checkpoint"]>;
  }> = {},
) => {
  const parent = await temporaryDirectory();
  const projects = new ProjectSessionService();
  const jobs = new StudioJobRegistry();
  const render = new RenderApiService({
    projects,
    jobs,
    executeRender,
    evaluateQa: fixtureQaEvaluator,
    ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
  });
  const token = "render-api-session-token-abcdefghijklmnopqrstuvwxyz";
  let origins: readonly string[] = [];
  const server = createStudioServer({
    sessionToken: token,
    allowedOrigins: () => origins,
    projectService: projects,
    jobRegistry: jobs,
    renderService: render,
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origins = [`http://127.0.0.1:${port.toString()}`];
  const request = requestFor(port, token, origins[0] ?? "");
  expect(
    (
      await request("/api/v1/projects/create", {
        method: "POST",
        body: JSON.stringify({ targetPath: path.join(parent, "Render API.chai"), title: "Render API" }),
      })
    ).status,
  ).toBe(201);
  return { projects, jobs, render, request };
};

const fixtureQaEvaluator: QaEvaluator = async ({ output, rootPath, report }) => {
  report(0.25);
  const receipt = JSON.parse(
    await readFile(path.join(rootPath, "receipts", "renders", output.id, "render.json"), "utf8"),
  ) as RenderReceiptBase;
  if (receipt.audio.status !== "measured") throw new Error("Render API fixture expects measured audio.");
  const durationFrames = (
    BigInt(receipt.dag.range.endFrameExclusive) - BigInt(receipt.dag.range.startFrame)
  ).toString(10);
  const primary = output.artifacts.find((artifact) => artifact.primary);
  if (primary === undefined) throw new Error("Render API fixture has no primary artifact.");
  const structural = evaluateStructuralOutput({
    artifactPath: primary.relativePath,
    probeEvidenceHash: primary.contentHash,
    probeVersion: "explicit lifecycle-test fixture",
    readable: true,
    contentHash: primary.contentHash,
    expectedContentHash: primary.contentHash,
    durationFrames,
    expectedDurationFrames: durationFrames,
    width: output.profile.width,
    height: output.profile.height,
    expectedWidth: output.profile.width,
    expectedHeight: output.profile.height,
    fps: output.profile.fps,
    expectedFps: output.profile.fps,
    container: output.profile.container,
    expectedContainer: output.profile.container,
    videoCodec: output.profile.videoCodec,
    expectedVideoCodec: output.profile.videoCodec,
    audioCodec: output.profile.audioCodec,
    expectedAudioCodec: output.profile.audioCodec,
    audioPresent: true,
    expectedAudio: true,
    sampleRate: receipt.audio.sampleRate,
    expectedSampleRate: output.profile.audioSampleRate,
    channels: receipt.audio.channels,
    expectedChannels: receipt.audio.channels,
    frameCount: durationFrames,
    frame: null,
    frameRange: receipt.dag.range,
  });
  const audioFinding = evaluateAudioMeasurements({
    artifactHash: receipt.audio.artifactHash,
    durationSamples: receipt.audio.durationSamples,
    expectedDurationSamples: receipt.audio.durationSamples,
    integratedLufs: receipt.audio.integratedLufs,
    targetLufs: -16,
    loudnessToleranceLufs: 4,
    truePeakDbtp: receipt.audio.truePeakDbtp,
    maximumTruePeakDbtp: 0,
    clippedSampleCount: receipt.audio.clippedSampleCount,
    silentSampleCount: receipt.audio.silentSampleCount,
    totalSampleCount: (BigInt(receipt.audio.durationSamples) * BigInt(receipt.audio.channels)).toString(10),
    channels: receipt.audio.channels,
    expectedChannels: receipt.audio.channels,
    syncDeltaSamples: "0",
    maximumSyncDeltaSamples: "1",
  });
  const failed = structural.status === "failed" || audioFinding.status === "failed";
  report(0.9);
  return {
    state: failed ? "qa_failed" : "qa_passed",
    evidenceHashes: output.artifacts.map((artifact) => artifact.contentHash),
    exceptionIds: [],
    primaryArtifactProbe: null,
    findings: [structural, audioFinding],
    audio: {
      status: failed ? "failed" : "passed",
      measurementVersion: receipt.audio.measurementVersion,
      reasons: failed ? ["Explicit lifecycle fixture contains clipped audio."] : [],
      measurements: receipt.audio,
    },
  };
};

const renderBody = (expectedRevisionId: string) => {
  const profile = builtInDeliveryProfiles()[0];
  if (profile === undefined) throw new Error("The built-in delivery profile fixture is missing.");
  return {
    profile,
    scope: { kind: "full-timeline" } as const,
    name: "Render API timeline",
    priority: 0,
    actor: actor(),
    expectedRevisionId,
    correlationId: "correlation-render-api-default-0001",
  };
};

const audioEvidence = (content: string) =>
  renderAudioEvidenceFromMixArtifact(
    {
      schemaVersion: "1.0.0",
      graphId: "audio-graph-render-api-test-0001",
      range: { startFrame: "0", endFrameExclusive: "30" },
      sampleRange: { startSample: "0", endSampleExclusive: "48048" },
      sampleRate: 48_000,
      channels: 2,
      codec: "pcm-f32le",
      outputPath: "program-audio.wav",
      artifactHash: createHash("sha256").update(content).digest("hex"),
      graphIdentity: "b".repeat(64),
      measurements: {
        schemaVersion: "1.0.0",
        sampleRate: 48_000,
        channels: 2,
        sampleCountPerChannel: 48_048,
        durationSamples: 48_048n,
        integratedLufs: -16,
        truePeakDbtp: -0.5,
        peakDbfs: -1,
        clippedSampleCount: 0,
        silentSampleCount: 0,
        silenceRatio: 0,
        channelPeaksDbfs: [-1, -1],
      },
    },
    "stereo",
  );

const fixturePlan = (request: RenderRequestRecord): RenderPlan => {
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
  const dependencyManifest = mergeRenderDependencies([
    [
      {
        category: "project",
        id: request.projectId,
        contentHash: request.revisionHash,
        source: "immutable-project-revision",
        requiredBy: ["node-master"],
        portability: "strict",
        metadata: { revisionId: request.revisionId },
      },
    ],
  ]);
  const environment = buildRenderEnvironmentIdentity(
    {
      schemaVersion: "1.0.0",
      os: "darwin",
      architecture: "arm64",
      osVersion: "fixture",
      gpu: "fixture-gpu",
      nodeVersion: process.version,
      browserExecutableHash: digest("playwright-managed-headless-shell"),
      browserIdentity: "playwright-managed:chromium_headless_shell-1228",
      rendererVersions: { shared: "fixture-1" },
      ffmpegVersion: "fixture-ffmpeg",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      colorContractId: "chai-render-fixture-color-v1",
      lockfileHash: digest("fixture-lockfile"),
    },
    {
      schemaVersion: "1.0.0",
      architecture: "arm64",
      browserMajor: "fixture",
      rendererVersions: { shared: "fixture-1" },
      colorContractId: "chai-render-fixture-color-v1",
    },
  );
  return createRenderPlan({
    id: `render-plan-${request.id}`,
    dag: {
      schemaVersion: "1.0.0",
      id: `render-dag-${request.id}`,
      projectId: request.projectId,
      revisionId: request.revisionId,
      timelineId: "timeline-main-0001",
      range: { startFrame: "0", endFrameExclusive: "30" },
      fps:
        request.profile.fps === null
          ? normalizeRational(30n, 1n)
          : normalizeRational(BigInt(request.profile.fps.numerator), BigInt(request.profile.fps.denominator)),
      nodes: [
        {
          schemaVersion: "1.0.0",
          id: "node-master",
          kind: "master-composition",
          label: "Fixture master compositor",
          dependsOn: [],
          input: { profileId: request.profile.id },
          expectedOutputs: [],
          cachePolicy: "strict",
          trustClass: "trusted-authored",
          resources: { cpu: 1, memoryMiB: 64, gpu: "none", browser: false },
          retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
        },
      ],
      roots: ["node-master"],
    },
    dependencyManifest,
    environment,
    decisions: [
      {
        entityId: "timeline-main-0001",
        path: "unified",
        owner: "shared",
        capabilityIdentity: digest("fixture-capability"),
        approximation: null,
        fallback: null,
        findings: [],
      },
    ],
  });
};

const fixtureSecurity = (request: RenderRequestRecord) => ({
  schemaVersion: "1.0.0" as const,
  policyIdentity: createHash("sha256").update(`security-policy:${request.id}`).digest("hex"),
  trustClasses: ["trusted_authored" as const],
  workerPoolIds: ["trusted-worker-fixture-v1"],
  cacheNamespaces: ["trusted-cache-fixture-v1"],
  environmentIdentity: fixturePlan(request).environment.strictEnvironmentFingerprint,
  approvedNetworkHashes: [],
  isolationEvidenceHash: null,
  violations: [],
});

const actor = () => ({
  id: "actor-render-api-0001",
  kind: "user" as const,
  sessionId: "session-render-api-0001",
});

const requestFor =
  (port: number, token: string, origin: string) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-chai-csrf-token", token);
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    return fetch(`http://127.0.0.1:${port.toString()}${endpoint}`, { ...init, headers });
  };

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-render-api-"));
  temporaryDirectories.push(directory);
  return directory;
};

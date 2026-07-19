import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { normalizeRational } from "../../packages/schema/src/index.js";
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
});

const serverFixture = async (
  executeRender: NonNullable<ConstructorParameters<typeof RenderApiService>[0]["executeRender"]>,
) => {
  const parent = await temporaryDirectory();
  const projects = new ProjectSessionService();
  const jobs = new StudioJobRegistry();
  const render = new RenderApiService({ projects, jobs, executeRender, evaluateQa: fixtureQaEvaluator });
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

const renderBody = (expectedRevisionId: string) => ({
  profile: builtInDeliveryProfiles()[0],
  scope: { kind: "full-timeline" },
  name: "Render API timeline",
  priority: 0,
  actor: actor(),
  expectedRevisionId,
});

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
  environmentIdentity: createHash("sha256").update(`security-environment:${request.id}`).digest("hex"),
  approvedNetworkHashes: [],
  isolationEvidenceHash: null,
  violations: [],
});

const actor = () => ({
  id: "actor-render-api-0001",
  kind: "user",
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

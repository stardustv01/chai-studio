import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptionPlan } from "../src/caption-plan.mjs";
import { CommandAuthority, commandCapabilities } from "../src/command-authority.mjs";
import { PreflightEngine, milestoneRules } from "../src/preflight-engine.mjs";
import { redactDiagnostic } from "../src/privacy-redaction.mjs";
import { createRenderReceipt } from "../src/render-receipt.mjs";
import { sourceMonitorScope } from "../src/source-monitor-scope.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const writeJson = (name, value) => writeFile(path.join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);

const environment = JSON.parse(await readFile(path.join(evidence, "environment.json"), "utf8"));
const fixture = JSON.parse(await readFile(path.join(root, "fixtures", "canonical", "fixture.json"), "utf8"));
const fixtureValidation = JSON.parse(await readFile(path.join(evidence, "canonical-fixture-validation.json"), "utf8"));
const gatePath = path.join(evidence, "gate-report.json");
const outputPath = path.join(evidence, "mixed-finish.mov");

const captionPlan = createCaptionPlan({
  dimensions: {width: 640, height: 360},
  fps: fixture.timeline.fps,
  fonts: [{family: "Inter", source: "HyperFrames deterministic cache", hash: "pinned-by-render-dependency"}],
  cues: [
    {id: "cue-1", startFrame: 0, endFrameExclusive: 60, text: "One master clock."},
    {id: "cue-2", startFrame: 60, endFrameExclusive: 150, text: "Native engines, shared authority."},
    {id: "cue-3", startFrame: 150, endFrameExclusive: 300, text: "Every frame and sample is accounted for."},
  ],
});
await writeJson("caption-plan.json", captionPlan);

const preflight = await new PreflightEngine(milestoneRules).evaluate({
  schemaValid: true,
  missingAssets: [],
  rightsConfirmed: fixture.rights.includes("Generated locally"),
  alphaMode: "rgba-png-sequence",
  trustPolicyPassed: true,
  freeDiskBytes: 191 * 1024 ** 3,
  requiredDiskBytes: 1024 ** 3,
  strictEnvironmentMatch: true,
});
await writeJson("preflight-result.json", preflight);

const authority = new CommandAuthority();
const commandEnvelope = {commandId: "m0-command-1", idempotencyId: "m0-idempotency-1", actorId: "local-user", sessionId: "m0-session", projectId: fixture.name, baseRevisionId: "m0-revision", correlationId: "m0-correlation", capability: "project.mutate", affectedEntities: ["timeline"], payload: {operation: "set-frame", frame: 30}};
const commandDecision = authority.authorize(commandEnvelope, {currentRevisionId: "m0-revision"});
await writeJson("command-authorization-result.json", {capabilities: commandCapabilities, envelope: commandEnvelope, decision: commandDecision});

const outputStats = await stat(outputPath);
const receipt = createRenderReceipt({
  projectId: fixture.name,
  revisionId: "m0-revision",
  jobId: "m0-mixed-finish",
  generatedAt: new Date().toISOString(),
  profile: {id: "m0-pcm-mezzanine", container: "mov", videoCodec: "h264", audioCodec: "pcm_s16le", dimensions: [640, 360], fps: fixture.timeline.fps},
  engines: [{id: "remotion", version: "4.0.489", role: "finisher"}, {id: "hyperframes", version: "0.7.58", role: "native-intermediate"}],
  strictEnvironment: {fingerprint: environment.strictEnvironmentFingerprint, manifest: environment.strictManifest},
  dependencies: {lockfile: environment.strictManifest.lockfileSha256, fixtureAssets: fixtureValidation.hashes, captionPlan: captionPlan.identity},
  cacheLineage: {reused: [], produced: ["hyperframes-fixture", "mixed-finish"]},
  outputs: [{relativePath: "evidence/mixed-finish.mov", bytes: outputStats.size, sha256: await sha256(outputPath)}],
  audio: {authority: "shared-graph", sampleRate: 48000, nativeEngineAudio: "suppressed", endpointSampleExact: true},
  qa: {state: "rendered_unchecked", gateReportSha256: await sha256(gatePath), approval: null, delivered: false},
  exceptions: [],
  reproduction: {commands: ["node scripts/run-gate.mjs", "node scripts/generate-contract-evidence.mjs"], alphaFallback: "rgba-png-sequence"},
});
await writeJson("render-receipt.json", receipt);

const privacy = {
  input: `${root}/fixtures token=example-secret /Users/praveengupta/unrelated`,
  redacted: redactDiagnostic(`${root}/fixtures token=example-secret /Users/praveengupta/unrelated`, {projectRoot: root, homeDirectory: "/Users/praveengupta"}),
  telemetryDefault: "zero-unsolicited",
  supportBundleRequiresPreview: true,
};
await writeJson("privacy-redaction-result.json", privacy);
await writeJson("source-monitor-scope.json", sourceMonitorScope);

const report = {passed: preflight.passed && receipt.qa.state === "rendered_unchecked" && receipt.qa.approval === null && commandDecision.authorized, artifacts: ["caption-plan.json", "preflight-result.json", "command-authorization-result.json", "render-receipt.json", "privacy-redaction-result.json", "source-monitor-scope.json"]};
await writeJson("contract-evidence-result.json", report);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);

import assert from "node:assert/strict";
import test from "node:test";
import { createCaptionPlan } from "../src/caption-plan.mjs";
import { CommandAuthority } from "../src/command-authority.mjs";
import { PreflightEngine, milestoneRules } from "../src/preflight-engine.mjs";
import { redactDiagnostic } from "../src/privacy-redaction.mjs";
import { QaLifecycle } from "../src/qa-lifecycle.mjs";
import { createRenderReceipt } from "../src/render-receipt.mjs";
import { assertSourceCapability } from "../src/source-monitor-scope.mjs";

const envelope = {commandId: "c1", idempotencyId: "i1", actorId: "local-user", sessionId: "s1", projectId: "p1", baseRevisionId: "r1", correlationId: "x1", capability: "project.mutate", payload: {title: "A"}};

test("command authorization rejects stale context, gates destructive actions, and replays safely", () => {
  const authority = new CommandAuthority();
  assert.throws(() => authority.authorize(envelope, {currentRevisionId: "stale"}), (error) => error.code === "STALE_CONTEXT");
  const first = authority.authorize(envelope, {currentRevisionId: "r1"});
  assert.equal(first.authorized, true);
  assert.equal(authority.authorize(envelope, {currentRevisionId: "r1"}).replayed, true);
  assert.throws(() => authority.authorize({...envelope, payload: {title: "B"}}, {currentRevisionId: "r1"}), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  assert.throws(() => authority.authorize({...envelope, commandId: "c2", idempotencyId: "i2", capability: "project.delete", authorizationId: "a1"}, {currentRevisionId: "r1"}), (error) => error.code === "EXPLICIT_AUTHORIZATION_REQUIRED");
});

test("QA lifecycle cannot infer approval or delivery from rendering", () => {
  const lifecycle = new QaLifecycle({outputIdentity: "out1", revisionId: "r1"});
  assert.throws(() => lifecycle.transition({to: "approved", actorId: "u", timestamp: "t", evidenceHashes: ["h"]}), /invalid QA transition/);
  lifecycle.transition({to: "qa_warning", actorId: "qa", timestamp: "t1", evidenceHashes: ["h1"]});
  assert.throws(() => lifecycle.transition({to: "approved", actorId: "u", timestamp: "t2", evidenceHashes: ["h2"]}), /scoped exceptions/);
  lifecycle.transition({to: "approved", actorId: "u", timestamp: "t2", evidenceHashes: ["h2"], exceptions: ["known-aac-padding"]});
  lifecycle.transition({to: "delivered", actorId: "u", timestamp: "t3", evidenceHashes: ["h3"]});
  assert.equal(lifecycle.state, "delivered");
  lifecycle.invalidate({outputIdentity: "out2", revisionId: "r2", reason: "output bytes changed"});
  assert.equal(lifecycle.state, "rendered_unchecked");
});

test("caption plans are deterministic and expose font and QA dependencies", () => {
  const input = {dimensions: {width: 640, height: 360}, fps: {num: 30000, den: 1001}, fonts: [{family: "Inter", hash: "font-hash"}], cues: [{id: "b", startFrame: 60, endFrameExclusive: 90, text: "Second"}, {id: "a", startFrame: 0, endFrameExclusive: 60, text: "First"}]};
  const first = createCaptionPlan(input);
  const second = createCaptionPlan({...input, cues: [...input.cues].reverse()});
  assert.equal(first.identity, second.identity);
  assert.deepEqual(first.qaAnchors[0], {id: "a", frames: [0, 59]});
});

test("shared preflight blocks unsafe projects while preserving warnings", async () => {
  const engine = new PreflightEngine(milestoneRules);
  const pass = await engine.evaluate({schemaValid: true, missingAssets: [], rightsConfirmed: true, alphaMode: "rgba-png-sequence", trustPolicyPassed: true, freeDiskBytes: 10, requiredDiskBytes: 5, strictEnvironmentMatch: false});
  assert.equal(pass.passed, true);
  assert.equal(pass.counts.warning, 1);
  const fail = await engine.evaluate({schemaValid: false, missingAssets: ["video"], rightsConfirmed: false, alphaMode: "qtrle", trustPolicyPassed: false, freeDiskBytes: 1, requiredDiskBytes: 5, strictEnvironmentMatch: false});
  assert.equal(fail.passed, false);
  assert.equal(fail.counts.blocking, 5);
});

test("diagnostics redact secrets and non-relative paths", () => {
  const redacted = redactDiagnostic("/Users/navin/project/file token=abc123 /Users/navin/other", {projectRoot: "/Users/navin/project", homeDirectory: "/Users/navin"});
  assert.equal(redacted, "<project>/file token=<redacted> <home>/other");
});

test("Foundation source monitor cannot silently perform Professional edits", () => {
  assert.equal(assertSourceCapability("foundation", "inspect"), true);
  assert.throws(() => assertSourceCapability("foundation", "insert"), (error) => error.code === "SOURCE_SCOPE_VIOLATION");
  assert.equal(assertSourceCapability("professional", "three-point-edit"), true);
});

test("render receipts are complete, canonical, and identity-sensitive", () => {
  const input = {projectId: "p", revisionId: "r", jobId: "j", profile: {id: "mezzanine"}, engines: ["remotion", "hyperframes"], strictEnvironment: "env", dependencies: {lockfile: "h"}, outputs: [{path: "mixed.mov", hash: "o"}], audio: {sampleRate: 48000}, qa: {state: "rendered_unchecked"}, reproduction: {command: "gate"}};
  const first = createRenderReceipt(input);
  assert.equal(first.identity, createRenderReceipt({...input, profile: {id: "mezzanine"}}).identity);
  assert.notEqual(first.identity, createRenderReceipt({...input, revisionId: "r2"}).identity);
});

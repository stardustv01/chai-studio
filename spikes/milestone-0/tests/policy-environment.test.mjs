import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvironmentFingerprints, environmentFingerprint } from "../src/environment.mjs";
import { assertPathAllowed, sanitizeEnvironment } from "../src/security-policy.mjs";

test("environment identity is canonical and sensitive to meaningful changes", () => {
  const a = environmentFingerprint({ node: "22.17.0", engines: { remotion: "4.0.489", hyperframes: "0.7.58" } });
  const b = environmentFingerprint({ engines: { hyperframes: "0.7.58", remotion: "4.0.489" }, node: "22.17.0" });
  const changed = environmentFingerprint({ node: "22.17.0", engines: { remotion: "4.0.490", hyperframes: "0.7.58" } });
  assert.equal(a, b);
  assert.notEqual(a, changed);
});

test("strict identity changes on patch versions while compatible preview identity stays major-compatible", () => {
  const base = {platform: "darwin", architecture: "arm64", node: "v22.17.0", chrome: "150.0", remotion: "4.0.489", hyperframes: "0.7.58", ffmpeg: "7.1.1", lockfileSha256: "a"};
  const patchChanged = {...base, remotion: "4.0.490", lockfileSha256: "b"};
  const first = buildEnvironmentFingerprints(base);
  const second = buildEnvironmentFingerprints(patchChanged);
  assert.notEqual(first.strictEnvironmentFingerprint, second.strictEnvironmentFingerprint);
  assert.equal(first.compatiblePreviewFingerprint, second.compatiblePreviewFingerprint);
  assert.equal(first.reusePolicy.finalArtifacts, "strict-only");
  assert.notEqual(first.compatiblePreviewFingerprint, buildEnvironmentFingerprints({...base, hyperframes: "0.8.0"}).compatiblePreviewFingerprint);
});

test("path policy rejects traversal outside approved roots", () => {
  assert.equal(assertPathAllowed({ candidate: "/project/assets/a.png", allowedRoots: ["/project"] }), "/project/assets/a.png");
  assert.throws(() => assertPathAllowed({ candidate: "/project/../secret.txt", allowedRoots: ["/project"] }), { code: "PATH_POLICY_VIOLATION" });
});

test("environment policy exposes allowlisted values only", () => {
  assert.deepEqual(sanitizeEnvironment({ LANG: "en_US.UTF-8", SECRET: "hidden", TZ: "UTC" }, ["LANG", "TZ"]), { LANG: "en_US.UTF-8", TZ: "UTC" });
});

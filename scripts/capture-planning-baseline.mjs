import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "..");
const planningRoot = path.resolve(workspace, "..");
const files = [
  "CHAI_STUDIO_MASTER_PLAN.md",
  "CHAI_STUDIO_FINAL_UPDATED_IMPLEMENTATION_PLAN.md",
  "CHAI_STUDIO_FINAL_TASK_GRAPH.json",
  "ARCHITECTURE_DECISIONS.md",
  "PRODUCT_REQUIREMENTS.md",
  "PROJECT_SCHEMA.md",
  "TEST_STRATEGY.md",
  "UI_SPECIFICATION.md",
  "TIMING_AND_AUDIO_CONTRACT.md",
  "ENGINE_ADAPTER_CONTRACT.md",
  "CODEX_BRIDGE_COMMAND_CONTRACT.md",
  "QA_DELIVERY_STATE_CONTRACT.md",
  "CAPTION_RENDER_CONTRACT.md",
  "SECURITY_POLICY_CONTRACT.md",
  "ui-samples/index.html",
  "ui-samples/01-edit-workspace.png",
  "ui-samples/02-inspect-codex-bridge.png",
  "ui-samples/03-deliver-render-qa.png",
  "ui-samples/04-media-source-monitor.png",
  "ui-samples/05-animation-bridge-editor.png",
];
const artifacts = [];
for (const relativePath of files) {
  const content = await readFile(path.join(planningRoot, relativePath));
  artifacts.push({
    relativePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}
const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  authority:
    "User-approved Chai Studio planning baseline; implementation changes require change control and a new baseline identity.",
  scope: "Foundation plus Professional Expansion for a personal macOS-first local application",
  artifacts,
};
baseline.identity = createHash("sha256").update(JSON.stringify(artifacts)).digest("hex");
await mkdir(path.join(workspace, "governance"), { recursive: true });
await writeFile(
  path.join(workspace, "governance", "execution-baseline.json"),
  `${JSON.stringify(baseline, null, 2)}\n`,
);
console.log(JSON.stringify({ identity: baseline.identity, artifactCount: artifacts.length }, null, 2));

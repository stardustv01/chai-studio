import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P22.01",
    "packages/qa/src/contracts.ts",
    ["QaRuleDefinition", "QaFinding", "QaLocation", "QaMetric", "environmentFingerprint", "repairHint"],
  ],
  [
    "P22.01-P22.02",
    "packages/qa/src/rules.ts",
    ["centralizedQaRules", "qaRuleSetIdentity", "qa.pre.schema", "qa.pre.environment", "qa.post.sync"],
  ],
  [
    "P22.02",
    "packages/qa/src/preflight.ts",
    ["createPreRenderQaReport", "deliveryCodeToRule", "qa.pre.rights", "qa.pre.timeline"],
  ],
  [
    "P22.03-P22.04",
    "packages/qa/src/evaluators.ts",
    ["evaluateStructuralOutput", "evaluateAudioMeasurements", "frame count", "true peak", "syncDelta"],
  ],
  [
    "P22.05-P22.08",
    "packages/qa/src/visual.ts",
    ["evaluateVisualCheckpoint", "evaluateStrictFidelity", "evaluatePerceptualFidelity", "measuredThreshold"],
  ],
  [
    "P22.09-P22.10",
    "packages/qa/src/language-sync.ts",
    ["evaluateCaptionQa", "evaluateSyncAnchor", "phraseSyncDelta", "sampleDelta"],
  ],
  [
    "P22.11-P22.13",
    "packages/qa/src/lifecycle.ts",
    ["assertQaLifecycleTransition", "currentOutputId", "exceptionApplies", "approved->delivered"],
  ],
  [
    "P22.12",
    "packages/qa/src/checklist.ts",
    ["createReviewChecklist", "recordReviewChecklistItem", "transition-midpoint", "phrase-anchor"],
  ],
  [
    "P22.02-P22.14",
    "apps/studio-server/src/render-service.ts",
    [
      "createPreRenderQaReport",
      "evaluateStructuralOutput",
      "evaluateAudioMeasurements",
      "qaWorkspace",
      "recordChecklistItem",
      "Approval requires every generated visual review checklist item",
      "Delivery requires the exact immutable approved output",
      "transitionQaLifecycle",
    ],
  ],
  [
    "P22.11-P22.14",
    "apps/studio-server/src/project-service.ts",
    [
      "transitionQaLifecycle",
      "authoritative QA lifecycle service",
      "assertQaLifecycleTransition",
      "isLifecycleCommand",
    ],
  ],
  [
    "P22.11-P22.14",
    "apps/studio-server/src/index.ts",
    ["checklistMatch", "receipt|qa|approve|deliver", "service.qaWorkspace", "service.deliver"],
  ],
  [
    "P22.02-P22.14",
    "apps/studio-web/src/delivery-workspace.tsx",
    ["Central QA rules", "Machine QA", "Required visual review", "Approve exact output", "Record delivery"],
  ],
  [
    "P22.14",
    "tests/integration/server-render-api.test.ts",
    ["workspace.rules", "checklist", "/deliver", 'currentState).toBe("delivered")'],
  ],
  [
    "P22.14",
    "tests/integration/qa-lifecycle-authority.test.ts",
    ["generic-command and state-skip bypasses", "new immutable output identity"],
  ],
  [
    "P22.14",
    "tests/e2e/qa-delivery-gate.spec.ts",
    ["22 checks", "8/10", "Approve exact output", "p22-qa-delivery-gate.png"],
  ],
];

const results = [];
for (const [task, file, symbols] of checks) {
  let content = "";
  let exists = true;
  try {
    content = await readFile(path.join(root, file), "utf8");
  } catch {
    exists = false;
  }
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({ task, file, passed: exists && missingSymbols.length === 0, exists, missingSymbols });
}

for (const file of [
  "fixtures/deterministic/qa/visual-fixtures.json",
  "tests/e2e/qa-delivery-gate.spec.ts-snapshots/p22-qa-delivery-gate-darwin.png",
  "fixtures/goldens/checksum-manifest.json",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P22.05-P22.14", file, passed: exists, exists, missingSymbols: [] });
}

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P22", taskRange: "P22.01-P22.14", passed, results }, null, 2));
if (!passed) process.exitCode = 1;

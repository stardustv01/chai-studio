import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P19.01",
    "packages/schema/src/project-documents.ts",
    [
      "ReviewActor",
      "ReviewIssueTransition",
      "ReviewIssueDocument",
      "ReviewBundleDocument",
      "ReviewComparisonDocument",
      "ReviewRequestDocument",
      "ReviewActionDocument",
      "AcceptedExceptionDocument",
      "AlternateTakeDocument",
      "ReviewStateDocument",
      "reviewState?",
    ],
  ],
  [
    "P19.01-P19.02",
    "packages/schema/src/source/project-documents.schema.json",
    [
      "reviewState",
      "bundles",
      "issues",
      "comparisons",
      "requests",
      "actions",
      "exceptions",
      "alternateTakes",
    ],
  ],
  [
    "P19.02-P19.07",
    "packages/review/src/index.ts",
    [
      "review.bundle.create",
      "review.bundle.delete",
      "review.issue.create",
      "review.issue.transition",
      "review.comparison.create",
      "review.request.create",
      "review.action.record",
      "review.exception.accept",
      "review.take.add",
      "review.take.activate",
      "resolved->acknowledged",
      "accepted-exception->acknowledged",
      "rejected->acknowledged",
      "lifecycle state remains unchanged",
      "buildVersionStacks",
      "scope is incomplete",
    ],
  ],
  ["P19.02", "packages/schema/src/command-envelope.ts", ["review.edit", "ReviewEditCommand"]],
  [
    "P19.02",
    "packages/schema/src/command-engine.ts",
    ["applyReviewEdit", "review.edit.executor-unavailable", "Review edit omitted affected entity"],
  ],
  [
    "P19.04-P19.06",
    "apps/studio-server/src/review-service.ts",
    [
      "ReviewWorkspaceSnapshot",
      "executeReviewDocumentEdit",
      "loadProjectRevision",
      "A/B revisions do not share the exact frame clock",
      "A/B comparison range is not present in both exact revisions",
      "chai-studio.review",
      "auditTrail",
    ],
  ],
  [
    "P19.06",
    "apps/studio-server/src/index.ts",
    ["/api/v1/review/workspace", "/api/v1/review/operations", "ReviewApiService"],
  ],
  [
    "P19.01-P19.08",
    "apps/studio-web/src/review-workspace.tsx",
    [
      "Authoritative review desk",
      "Bundle from selection",
      "New exact-frame issue",
      "Request feedback",
      "Recommend approval",
      "No lifecycle effect",
      "linked frame navigation",
      "Difference",
      "Export capture manifest",
      "Parity:",
      "Reveal source",
    ],
  ],
  [
    "P19.03-P19.07-P19.09",
    "tests/unit/review-core.test.ts",
    [
      "acknowledge, fix, resolve, and reopen",
      "non-lifecycle review decisions",
      "scoped exceptions",
      "one active alternate take",
    ],
  ],
  [
    "P19.09",
    "tests/integration/server-review-api.test.ts",
    ["exact A/B", "undo/redo", "accepted-exception", "recommended-approval", "named-versions", "auditTrail"],
  ],
  [
    "P19.04-P19.09",
    "tests/property/review-ranges.property.test.ts",
    ["non-empty exact frame range", "exceeds the exact timeline", "numRuns"],
  ],
  [
    "P19.08-P19.09",
    "tests/e2e/review-workspace.spec.ts",
    [
      "exact revision authority",
      "without implying approval",
      "Difference",
      "Export capture manifest",
      "p19-review-workspace.png",
    ],
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
  "packages/review/package.json",
  "packages/review/tsconfig.json",
  "tests/e2e/review-workspace.spec.ts-snapshots/p19-review-workspace-darwin.png",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P19.01-P19.09", file, passed: exists, exists, missingSymbols: [] });
}

const snapshotDirectory = path.join(root, "tests/e2e/review-workspace.spec.ts-snapshots");
let snapshots;
try {
  snapshots = (await readdir(snapshotDirectory)).filter((file) => file.endsWith("-darwin.png"));
} catch {
  snapshots = [];
}
results.push({
  task: "P19.08-P19.09",
  file: path.relative(root, path.join(snapshotDirectory, "p19-review-workspace-darwin.png")),
  passed: snapshots.includes("p19-review-workspace-darwin.png"),
  exists: snapshots.includes("p19-review-workspace-darwin.png"),
  missingSymbols: [],
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P19", taskRange: "P19.01-P19.09", passed, results }, null, 2));
if (!passed) process.exitCode = 1;

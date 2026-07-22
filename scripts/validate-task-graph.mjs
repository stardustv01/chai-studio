import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "..");
const configuredPlanningRoot = process.env.CHAI_STUDIO_PLANNING_ROOT?.trim();
const planningRoot = configuredPlanningRoot
  ? path.resolve(workspace, configuredPlanningRoot)
  : path.resolve(workspace, "..");
const writeReport = process.argv.includes("--write");
const graph = JSON.parse(
  await readFile(path.join(planningRoot, "CHAI_STUDIO_FINAL_TASK_GRAPH.json"), "utf8"),
);
const baseline = JSON.parse(
  await readFile(path.join(workspace, "governance", "execution-baseline.json"), "utf8"),
);
const ids = graph.tasks.map((task) => task.id);
const idSet = new Set(ids);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const missingDependencies = [];
for (const task of graph.tasks)
  for (const dependency of task.dependencies)
    if (!idSet.has(dependency)) missingDependencies.push({ taskId: task.id, dependency });

const indegree = new Map(ids.map((id) => [id, 0]));
const outgoing = new Map(ids.map((id) => [id, []]));
for (const task of graph.tasks)
  for (const dependency of task.dependencies) {
    indegree.set(task.id, indegree.get(task.id) + 1);
    outgoing.get(dependency)?.push(task.id);
  }
const queue = ids.filter((id) => indegree.get(id) === 0).sort();
const topologicalOrder = [];
while (queue.length) {
  const id = queue.shift();
  topologicalOrder.push(id);
  for (const dependent of outgoing.get(id)) {
    indegree.set(dependent, indegree.get(dependent) - 1);
    if (indegree.get(dependent) === 0) queue.push(dependent);
  }
  queue.sort();
}
const currentArtifacts = [];
for (const artifact of baseline.artifacts) {
  const content = await readFile(path.join(planningRoot, artifact.relativePath));
  currentArtifacts.push({ ...artifact, currentSha256: createHash("sha256").update(content).digest("hex") });
}
const changedBaselineArtifacts = currentArtifacts.filter(
  (artifact) => artifact.sha256 !== artifact.currentSha256,
);
const assertions = {
  phaseCount: graph.phase_count === 29,
  taskCount: graph.task_count === 379 && graph.tasks.length === 379,
  uniqueTaskIds: duplicateIds.length === 0,
  noMissingDependencies: missingDependencies.length === 0,
  acyclic: topologicalOrder.length === graph.tasks.length,
  completeDeclaredOrder: graph.topological_order.length === graph.tasks.length,
  baselineUnchanged: changedBaselineArtifacts.length === 0,
};
const reportPath = path.join(workspace, "governance", "task-graph-validation.json");
const reportBody = {
  passed: Object.values(assertions).every(Boolean),
  assertions,
  duplicateIds,
  missingDependencies,
  changedBaselineArtifacts,
  computedTopologicalOrderCount: topologicalOrder.length,
};
const report = { generatedAt: await stableGeneratedAt(reportPath, reportBody), ...reportBody };
const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
if (!writeReport) {
  const currentReport = await readFile(reportPath, "utf8").catch(() => "");
  if (currentReport !== serializedReport) {
    console.error("Task graph validation evidence is missing or stale.");
    process.exitCode = 1;
  }
} else {
  await writeFile(reportPath, serializedReport);
}
console.log(JSON.stringify({ passed: report.passed, assertions }, null, 2));
if (!report.passed) process.exitCode = 1;

async function stableGeneratedAt(reportPath, reportBody) {
  try {
    const previous = JSON.parse(await readFile(reportPath, "utf8"));
    const { generatedAt, ...previousBody } = previous;
    if (JSON.stringify(previousBody) === JSON.stringify(reportBody) && typeof generatedAt === "string") {
      return generatedAt;
    }
  } catch {
    // A missing or invalid prior report receives a fresh evidence timestamp.
  }
  return new Date().toISOString();
}

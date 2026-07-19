import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "..");
const contractsRoot = path.join(workspace, "governance", "contracts");
const index = JSON.parse(await readFile(path.join(contractsRoot, "contract-index.json"), "utf8"));
const ids = index.contracts.map((contract) => contract.id);
const idSet = new Set(ids);
const foundations = new Set(index.externalFoundations);
const missingDependencies = [];
for (const contract of index.contracts)
  for (const dependency of contract.dependsOn) {
    if (!idSet.has(dependency) && !foundations.has(dependency))
      missingDependencies.push({ contractId: contract.id, dependency });
  }
const indegree = new Map(ids.map((id) => [id, 0]));
const outgoing = new Map(ids.map((id) => [id, []]));
for (const contract of index.contracts)
  for (const dependency of contract.dependsOn)
    if (idSet.has(dependency)) {
      indegree.set(contract.id, indegree.get(contract.id) + 1);
      outgoing.get(dependency).push(contract.id);
    }
const queue = ids.filter((id) => indegree.get(id) === 0).sort();
const order = [];
while (queue.length) {
  const id = queue.shift();
  order.push(id);
  for (const dependent of outgoing.get(id)) {
    indegree.set(dependent, indegree.get(dependent) - 1);
    if (indegree.get(dependent) === 0) queue.push(dependent);
  }
  queue.sort();
}
const documents = [
  "01-audio-transport.md",
  "02-command-authorization.md",
  "03-qa-delivery-lifecycle.md",
  "04-caption-render.md",
  "05-executable-isolation.md",
  "06-privacy-diagnostics.md",
  "07-preflight.md",
  "08-source-monitor-boundary.md",
  "09-render-receipt.md",
];
const documentHashes = [];
for (const document of documents) {
  const content = await readFile(path.join(contractsRoot, document));
  documentHashes.push({
    document,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  });
}
const evidenceRoot = path.join(workspace, "spikes", "milestone-0", "evidence");
const requiredEvidence = [
  "gate-report.json",
  "web-audio-result.json",
  "isolation-report.json",
  "interactive-preview-result.json",
  "native-still-benchmark.json",
  "resource-benchmark.json",
  "mixed-finish-result.json",
  "contract-evidence-result.json",
  "render-receipt.json",
];
const evidenceStatus = [];
for (const file of requiredEvidence) {
  const content = await readFile(path.join(evidenceRoot, file));
  const parsed = JSON.parse(content);
  evidenceStatus.push({
    file,
    passed: parsed.passed !== false,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}
const duplicateIds = ids.filter((id, indexPosition) => ids.indexOf(id) !== indexPosition);
const duplicateOwners = index.contracts
  .map((contract) => contract.owner)
  .filter((owner, indexPosition, owners) => owners.indexOf(owner) !== indexPosition);
const assertions = {
  frozen: index.status === "frozen",
  contractCount: index.contracts.length === 9,
  uniqueIds: duplicateIds.length === 0,
  uniqueOwners: duplicateOwners.length === 0,
  noMissingDependencies: missingDependencies.length === 0,
  acyclic: order.length === ids.length,
  documentsComplete: documentHashes.length === 9,
  evidencePassed: evidenceStatus.every((item) => item.passed),
};
const reportPath = path.join(workspace, "governance", "contract-freeze-validation.json");
const reportBody = {
  passed: Object.values(assertions).every(Boolean),
  assertions,
  topologicalOrder: order,
  missingDependencies,
  duplicateIds,
  duplicateOwners,
  documentHashes,
  evidenceStatus,
};
const report = { generatedAt: await stableGeneratedAt(reportPath, reportBody), ...reportBody };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, assertions, topologicalOrder: order }, null, 2));
if (!report.passed) process.exit(1);

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

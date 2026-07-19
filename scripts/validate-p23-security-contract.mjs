import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P23.01",
    "governance/P23_THREAT_MODEL.md",
    ["Local HTTP server", "Executable compositions", "Residual risk"],
  ],
  [
    "P23.02",
    "apps/studio-server/src/request-security.ts",
    ["assertLoopbackBindHost", "server.origin-forbidden", "server.csrf-token-invalid", "timingSafeEqual"],
  ],
  [
    "P23.03",
    "packages/security/src/path-policy.ts",
    ["authorizeSecurityPath", "realpath", "rejectTraversalSyntax", "SecurityRootPolicy"],
  ],
  [
    "P23.04",
    "packages/security/src/policy.ts",
    ["createTrustClassification", "promoteTrustClassification", "exact composition source identity"],
  ],
  [
    "P23.04",
    "apps/studio-server/src/render-service.ts",
    ["securityWorkspace", "security.trust.unclassified", "security: redactedSecurity"],
  ],
  [
    "P23.05",
    "packages/security/src/network-policy.ts",
    ["authorizeNetworkResource", "approved non-local HTTPS", "verifyFetchedResource", "cannot enter cache"],
  ],
  [
    "P23.06",
    "packages/security/src/environment-policy.ts",
    ["sanitizeWorkerEnvironment", "forbiddenEnvironmentKey", "policy.locale", "policy.timezone"],
  ],
  [
    "P23.07",
    "packages/security/src/browser-policy.ts",
    ["authorizeBrowserCapability", "studioSecurityHeaders", "permissions-policy", "file-url"],
  ],
  [
    "P23.08-P23.09",
    "packages/security/src/worker-isolation.ts",
    [
      "createIsolatedWorkerLaunch",
      "sandbox-exec",
      "child-and-worker-denial",
      "assertArtifactProvenanceCompatible",
    ],
  ],
  [
    "P23.10",
    "packages/diagnostics/src/index.ts",
    ["redactTextWithContext", "redactValueWithContext", "allowedEnvironmentKeys", "temporary:"],
  ],
  [
    "P23.11",
    "packages/security/src/authorization.ts",
    ["DestructiveAuthorizationRegistry", "already consumed", "External publishing/uploading is unsupported"],
  ],
  [
    "P23.12",
    "scripts/generate-p23-license-inventory.mjs",
    [
      "installedDependencyTree",
      "distributionObligation",
      "bundledApplicationFonts",
      "bundledApplicationMedia",
    ],
  ],
  [
    "P23.13",
    "governance/licenses/release-review.json",
    ["public-distribution", "commercialization", "engine-upgrade", "blocked-pending-review"],
  ],
  [
    "P23.14",
    "tests/unit/security-policy.test.ts",
    ["denies network by default", "sanitizes environment", "single-use", "provenance"],
  ],
  [
    "P23.14",
    "tests/integration/security-path-containment.test.ts",
    ["traversal", "symlink escapes", "read-only sources"],
  ],
  [
    "P23.14",
    "tests/integration/security-server-boundary.test.ts",
    ["content-security-policy", "anti-CSRF", "permissions-policy"],
  ],
  [
    "P23.04-P23.14",
    "tests/integration/security-trust-preflight.test.ts",
    ["security.trust.unclassified", "security.imported-execution.disabled", "promotionReviewId"],
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
  "packages/security/src/contracts.ts",
  "packages/security/src/index.ts",
  "governance/licenses/dependency-inventory.json",
  "scripts/validate-p23-release-review.mjs",
  "spikes/milestone-0/evidence/isolation-report.json",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P23.01-P23.14", file, passed: exists, exists, missingSymbols: [] });
}
const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P23", taskRange: "P23.01-P23.14", passed, results }, null, 2));
if (!passed) process.exitCode = 1;

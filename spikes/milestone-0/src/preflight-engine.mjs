export class PreflightEngine {
  constructor(rules) {
    this.rules = [...rules];
  }

  async evaluate(context) {
    const results = [];
    for (const rule of this.rules) {
      const result = await rule.evaluate(context);
      results.push({ ruleId: rule.id, version: rule.version, ...result });
    }
    return Object.freeze({
      passed: !results.some((result) => result.severity === "blocking"),
      results,
      counts: {
        blocking: results.filter((result) => result.severity === "blocking").length,
        warning: results.filter((result) => result.severity === "warning").length,
        info: results.filter((result) => result.severity === "info").length,
      },
    });
  }
}

export const milestoneRules = [
  { id: "schema", version: 1, evaluate: ({ schemaValid }) => schemaValid ? { severity: "info", message: "schema valid" } : { severity: "blocking", message: "schema invalid" } },
  { id: "assets", version: 1, evaluate: ({ missingAssets = [] }) => missingAssets.length ? { severity: "blocking", message: "assets missing", entities: missingAssets } : { severity: "info", message: "assets available" } },
  { id: "rights", version: 1, evaluate: ({ rightsConfirmed }) => rightsConfirmed ? { severity: "info", message: "rights confirmed" } : { severity: "blocking", message: "rights not confirmed" } },
  { id: "alpha", version: 1, evaluate: ({ alphaMode }) => alphaMode === "rgba-png-sequence" ? { severity: "info", message: "supported alpha bridge" } : { severity: "warning", message: "alpha path requires fallback" } },
  { id: "trust", version: 1, evaluate: ({ trustPolicyPassed }) => trustPolicyPassed ? { severity: "info", message: "trust policy passed" } : { severity: "blocking", message: "trust policy failed" } },
  { id: "disk", version: 1, evaluate: ({ freeDiskBytes, requiredDiskBytes }) => freeDiskBytes >= requiredDiskBytes ? { severity: "info", message: "disk available" } : { severity: "blocking", message: "insufficient disk" } },
  { id: "environment", version: 1, evaluate: ({ strictEnvironmentMatch }) => strictEnvironmentMatch ? { severity: "info", message: "strict environment match" } : { severity: "warning", message: "compatible preview only" } },
];

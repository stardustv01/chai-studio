import path from "node:path";
import type { ExecutableSecurityPolicy, WorkerArtifactProvenance } from "./contracts.js";
import { securityIdentity } from "./identity.js";

export interface IsolatedWorkerLaunch {
  readonly executable: "/usr/bin/sandbox-exec";
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
  readonly outputLimitBytes: number;
  readonly enforcementMechanisms: readonly string[];
  readonly workerPoolId: string;
  readonly browserProfileId: string;
  readonly temporaryRootId: string;
  readonly cacheNamespace: string;
}

export const createIsolatedWorkerLaunch = (input: {
  readonly policy: ExecutableSecurityPolicy;
  readonly nodeExecutable: string;
  readonly entryFile: string;
  readonly environment: Readonly<Record<string, string>>;
}): IsolatedWorkerLaunch => {
  if (input.policy.trustClass !== "imported_untrusted") {
    throw new Error("Imported isolation launch requires imported_untrusted trust state.");
  }
  if (!input.policy.importedExecutionEnabled) throw new Error("Imported execution is disabled.");
  const readRoots = input.policy.rootPolicies.map((root) => root.path);
  const writeRoots = input.policy.rootPolicies
    .filter((root) => root.mode !== "read-only")
    .map((root) => root.path);
  const isolationId = securityIdentity({
    policy: input.policy.policyIdentity,
    trustClass: input.policy.trustClass,
  });
  const sandboxProfile = "(version 1)(allow default)(deny network*)";
  const nodeArguments = [
    `--max-old-space-size=${String(input.policy.limits.memoryMiB)}`,
    "--permission",
    ...readRoots.map((root) => `--allow-fs-read=${root}`),
    ...writeRoots.map((root) => `--allow-fs-write=${root}`),
    path.resolve(input.entryFile),
  ];
  return {
    executable: "/usr/bin/sandbox-exec",
    arguments: ["-p", sandboxProfile, path.resolve(input.nodeExecutable), ...nodeArguments],
    environment: input.environment,
    timeoutMs: input.policy.limits.wallTimeMs,
    maxBufferBytes: input.policy.limits.logBytes,
    outputLimitBytes: input.policy.limits.outputBytes,
    enforcementMechanisms: [
      "sandbox-exec-network-denial",
      "node-permission-canonical-roots",
      "child-and-worker-denial",
      "sanitized-environment",
      "v8-heap-limit",
      "parent-wall-time-log-output-caps",
    ],
    workerPoolId: `untrusted-worker-${isolationId}`,
    browserProfileId: `untrusted-browser-${isolationId}`,
    temporaryRootId: `untrusted-temp-${isolationId}`,
    cacheNamespace: `untrusted-cache-${isolationId}`,
  };
};

export const artifactProvenance = (input: {
  readonly artifactHash: string;
  readonly policy: ExecutableSecurityPolicy;
  readonly environmentIdentity: string;
  readonly launch: Pick<
    IsolatedWorkerLaunch,
    "workerPoolId" | "browserProfileId" | "temporaryRootId" | "cacheNamespace"
  >;
}): WorkerArtifactProvenance => ({
  schemaVersion: "1.0.0",
  artifactHash: input.artifactHash,
  trustClass: input.policy.trustClass,
  policyIdentity: input.policy.policyIdentity,
  workerPoolId: input.launch.workerPoolId,
  browserProfileId: input.launch.browserProfileId,
  temporaryRootId: input.launch.temporaryRootId,
  cacheNamespace: input.launch.cacheNamespace,
  environmentIdentity: input.environmentIdentity,
});

export const assertArtifactProvenanceCompatible = (
  artifact: WorkerArtifactProvenance,
  requestedPolicy: ExecutableSecurityPolicy,
): void => {
  if (
    artifact.trustClass !== requestedPolicy.trustClass ||
    artifact.policyIdentity !== requestedPolicy.policyIdentity ||
    !artifact.cacheNamespace.startsWith(
      `${requestedPolicy.trustClass === "imported_untrusted" ? "untrusted" : "trusted"}-cache-`,
    )
  ) {
    throw new Error("Artifact provenance cannot cross trust or security-policy cache boundaries.");
  }
};

export const assertResourceUsage = (
  policy: ExecutableSecurityPolicy,
  usage: Readonly<{
    cpuSeconds: number;
    memoryMiB: number;
    wallTimeMs: number;
    processCount: number;
    outputBytes: number;
    logBytes: number;
  }>,
): void => {
  for (const key of Object.keys(policy.limits) as (keyof typeof policy.limits)[]) {
    if (usage[key] > policy.limits[key]) throw new Error(`Worker exceeded ${key} resource limit.`);
  }
};

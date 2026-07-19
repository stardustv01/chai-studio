import { randomUUID } from "node:crypto";
import {
  planCapabilityRender,
  type CapabilityEngine,
  type CapabilityRegistry,
} from "@chai-studio/engine-adapters";
import type { JsonValue } from "@chai-studio/schema";
import type {
  RenderDag,
  RenderDependencyManifest,
  RenderEnvironmentIdentity,
  RenderPathDecision,
  RenderPlan,
  RenderPreflightFinding,
} from "./contracts.js";
import { validateRenderDag } from "./dag.js";
import { hashCanonicalRenderValue } from "./identity.js";

export const planCapabilityRequests = (
  registry: CapabilityRegistry,
  requests: readonly Readonly<{
    entityId: string;
    engine: CapabilityEngine;
    capabilityId: string;
    experimentalOptIn: boolean;
  }>[],
): readonly RenderPathDecision[] =>
  requests.map((request) => {
    const decision = planCapabilityRender(registry, request);
    const path =
      decision.action === "native"
        ? ("native" as const)
        : decision.action === "unified"
          ? ("unified" as const)
          : decision.action === "bake"
            ? ("baked" as const)
            : decision.action === "fallback"
              ? ("fallback" as const)
              : decision.action === "experimental-opt-in"
                ? ("experimental" as const)
                : ("unsupported" as const);
    const warning = path !== "native" && path !== "unified";
    const blocking = path === "unsupported";
    return {
      entityId: request.entityId,
      path,
      owner:
        decision.engine === "remotion"
          ? "remotion"
          : decision.engine === "hyperframes"
            ? "hyperframes"
            : "shared",
      capabilityIdentity: hashCanonicalRenderValue({
        registryId: registry.registryId,
        capabilityId: decision.capabilityId,
        engine: decision.engine,
        status: decision.status,
        evidenceIds: decision.evidenceIds,
      }),
      approximation: decision.approximation
        ? `Capability ${decision.capabilityId} uses an approximation.`
        : path === "baked"
          ? `Capability ${decision.capabilityId} is converted to a deterministic baked artifact.`
          : null,
      fallback: decision.fallbackId,
      findings: warning
        ? [
            {
              code: blocking ? "render.capability.unsupported" : `render.capability.${path}`,
              severity: blocking ? ("error" as const) : ("warning" as const),
              blocking,
              message: `Capability ${decision.capabilityId} selected ${path}.`,
              affectedIds: [request.entityId],
              repairHint: blocking
                ? "Remove or replace the unsupported capability."
                : "Review the declared fallback, approximation, and evidence before rendering.",
              evidenceHashes: [],
            },
          ]
        : [],
    };
  });

export const createRenderPlan = (input: {
  readonly id?: string;
  readonly dag: RenderDag;
  readonly dependencyManifest: RenderDependencyManifest;
  readonly environment: RenderEnvironmentIdentity;
  readonly decisions: readonly RenderPathDecision[];
  readonly sharedFindings?: readonly RenderPreflightFinding[];
}): RenderPlan => {
  validateRenderDag(input.dag);
  const findings = [...(input.sharedFindings ?? []), ...input.decisions.flatMap((item) => item.findings)];
  validateFindings(findings);
  const decided = new Set<string>();
  for (const decision of input.decisions) {
    if (decided.has(decision.entityId))
      throw new Error(`Duplicate render path decision: ${decision.entityId}.`);
    decided.add(decision.entityId);
    if (decision.path === "fallback" && decision.fallback === null) {
      throw new Error(`Fallback render path ${decision.entityId} has no explicit fallback.`);
    }
    if (decision.path === "experimental" && decision.fallback === null) {
      throw new Error(`Experimental render path ${decision.entityId} has no accepted fallback.`);
    }
    if (decision.path === "baked" && decision.approximation === null) {
      throw new Error(`Baked render path ${decision.entityId} does not disclose its approximation.`);
    }
  }
  const executable =
    !findings.some((finding) => finding.blocking || finding.severity === "error") &&
    !input.decisions.some((decision) => decision.path === "unsupported");
  const withoutHash = {
    schemaVersion: "1.0.0" as const,
    id: input.id ?? `render-plan-${randomUUID()}`,
    dag: input.dag,
    dependencyManifest: input.dependencyManifest,
    environment: input.environment,
    decisions: input.decisions,
    findings,
    executable,
  };
  return {
    ...withoutHash,
    identityHash: hashCanonicalRenderValue(withoutHash as unknown as JsonValue),
  };
};

const validateFindings = (findings: readonly RenderPreflightFinding[]): void => {
  for (const finding of findings) {
    if (!/^[a-z][a-z0-9.-]{2,127}$/.test(finding.code) || finding.message.trim() === "") {
      throw new Error("Render preflight finding is invalid.");
    }
    if (finding.severity === "error" && !finding.blocking) {
      throw new Error(`Render preflight error ${finding.code} must block execution.`);
    }
  }
};

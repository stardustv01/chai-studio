import { createHash } from "node:crypto";
import {
  capabilityStatuses,
  type CapabilityEngine,
  type CapabilityEntry,
  type CapabilityRegistry,
} from "./contracts.js";

export const createCapabilityRegistry = (entries: readonly CapabilityEntry[]): CapabilityRegistry => {
  const identities = new Set<string>();
  const validated = entries.map((entry) => {
    assertIdentifier(entry.capabilityId, "capabilityId");
    const identity = capabilityIdentity(entry.engine, entry.capabilityId);
    if (identities.has(identity)) throw new Error(`Capability entry ${identity} is duplicated.`);
    identities.add(identity);
    if (!capabilityStatuses.includes(entry.status))
      throw new Error(`Capability ${identity} status is invalid.`);
    if (entry.owner !== entry.engine && entry.owner !== "shared" && entry.owner !== "render-core") {
      throw new Error(`Capability ${identity} owner is incompatible with its engine.`);
    }
    if (entry.fixture.assertions.length === 0 || entry.fixture.testPath.trim() === "") {
      throw new Error(`Capability ${identity} lacks a passing fixture contract.`);
    }
    if (entry.evidence.length === 0) throw new Error(`Capability ${identity} lacks evidence.`);
    for (const evidence of entry.evidence) {
      assertIdentifier(evidence.evidenceId, "evidenceId");
      if (
        evidence.artifactPath.trim() === "" ||
        evidence.assertion.trim() === "" ||
        evidence.testedVersion.trim() === ""
      ) {
        throw new Error(`Capability ${identity} evidence is incomplete.`);
      }
    }
    if (
      (entry.status === "bake_required" || entry.status === "fallback_available") &&
      entry.fallback === null
    ) {
      throw new Error(`Capability ${identity} requires a declared fallback.`);
    }
    if (
      entry.status === "unsupported" &&
      (entry.previewBehavior !== "blocked" || entry.renderBehavior !== "blocked")
    ) {
      throw new Error(`Unsupported capability ${identity} must block preview and render.`);
    }
    if (
      entry.status === "experimental" &&
      (entry.previewBehavior !== "opt-in" || entry.renderBehavior !== "opt-in")
    ) {
      throw new Error(`Experimental capability ${identity} must require opt-in.`);
    }
    return Object.freeze({
      ...entry,
      restrictions: Object.freeze([...entry.restrictions]),
      evidence: Object.freeze([...entry.evidence]),
      fixture: Object.freeze({ ...entry.fixture, assertions: Object.freeze([...entry.fixture.assertions]) }),
      fallback:
        entry.fallback === null
          ? null
          : Object.freeze({
              ...entry.fallback,
              limitations: Object.freeze([...entry.fallback.limitations]),
            }),
    });
  });
  const sorted = validated.sort(
    (left, right) =>
      left.family.localeCompare(right.family) ||
      left.engine.localeCompare(right.engine) ||
      left.capabilityId.localeCompare(right.capabilityId),
  );
  return {
    schemaVersion: "1.0.0",
    registryId: createHash("sha256").update(JSON.stringify(sorted)).digest("hex"),
    entries: Object.freeze(sorted),
  };
};

export const capabilityIdentity = (engine: CapabilityEngine, capabilityId: string): string =>
  `${engine}:${capabilityId}`;

export const resolveCapability = (
  registry: CapabilityRegistry,
  engine: CapabilityEngine,
  capabilityId: string,
): CapabilityEntry => {
  const entry = registry.entries.find(
    (candidate) => candidate.engine === engine && candidate.capabilityId === capabilityId,
  );
  if (entry === undefined)
    throw new Error(`Capability ${capabilityIdentity(engine, capabilityId)} is unregistered.`);
  return entry;
};

const assertIdentifier = (value: string, field: string): void => {
  if (!/^[a-z][a-z0-9.-]{2,127}$/.test(value)) throw new Error(`Capability ${field} is invalid.`);
};

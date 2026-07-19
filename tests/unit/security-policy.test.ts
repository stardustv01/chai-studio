import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DestructiveAuthorizationRegistry,
  artifactProvenance,
  assertArtifactProvenanceCompatible,
  assertResourceUsage,
  authorizeBrowserCapability,
  authorizeNetworkResource,
  createExecutableSecurityPolicy,
  createIsolatedWorkerLaunch,
  createTrustClassification,
  promoteTrustClassification,
  sanitizeWorkerEnvironment,
  verifyFetchedResource,
} from "../../packages/security/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("central executable security policy", () => {
  it("requires exact explicit review to promote imported source trust", () => {
    const sourceHash = sha("composition-source");
    const imported = createTrustClassification({
      compositionId: "composition-security-0001",
      sourceHash,
      trustClass: "imported_untrusted",
      classifiedBy: "actor-security-0001",
      classifiedAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(imported.trustClass).toBe("imported_untrusted");
    expect(() =>
      promoteTrustClassification(imported, {
        schemaVersion: "1.0.0",
        id: "review-security-0001",
        compositionId: imported.compositionId,
        sourceHash: sha("different"),
        reviewerId: "reviewer-security-0001",
        decision: "approved",
        checklist: ["source", "network", "filesystem", "behavior"],
        reviewedAt: "2026-07-16T01:00:00.000Z",
      }),
    ).toThrow(/exact composition source/);
    expect(
      promoteTrustClassification(imported, {
        schemaVersion: "1.0.0",
        id: "review-security-0002",
        compositionId: imported.compositionId,
        sourceHash,
        reviewerId: "reviewer-security-0001",
        decision: "approved",
        checklist: ["source reviewed", "network reviewed", "filesystem reviewed", "behavior reviewed"],
        reviewedAt: "2026-07-16T01:00:00.000Z",
      }),
    ).toMatchObject({ trustClass: "trusted_authored", promotionReviewId: "review-security-0002" });
  });

  it("denies network by default and admits only exact hash-verified HTTPS bytes", async () => {
    const fixture = await fixtureRoots();
    const contentHash = sha("approved-resource");
    const policy = createExecutableSecurityPolicy({
      projectId: "project-security-0001",
      trustClass: "trusted_authored",
      importedExecutionEnabled: false,
      rootPolicies: fixture.policies,
      approvedNetworkResources: [{ url: "https://assets.example.test/frozen.js", contentHash }],
    });
    expect(() => authorizeNetworkResource(policy, "http://127.0.0.1:4317/secret", "preview")).toThrow(
      /non-local HTTPS/,
    );
    expect(() => authorizeNetworkResource(policy, "https://assets.example.test/other.js", "preview")).toThrow(
      /exact URL and hash/,
    );
    const approved = authorizeNetworkResource(
      policy,
      "https://assets.example.test/frozen.js",
      "final-render",
    );
    expect(() => {
      verifyFetchedResource(approved, sha("tampered"));
    }).toThrow(/cannot enter cache/);
    expect(() => {
      verifyFetchedResource(approved, contentHash);
    }).not.toThrow();
  });

  it("sanitizes environment and enforces browser capability restrictions", async () => {
    const fixture = await fixtureRoots();
    const allowedFile = path.join(fixture.source, "allowed.txt");
    await writeFile(allowedFile, "allowed");
    const policy = createExecutableSecurityPolicy({
      projectId: "project-security-0002",
      trustClass: "trusted_authored",
      importedExecutionEnabled: false,
      rootPolicies: fixture.policies,
      environmentAllowlist: ["RENDER_QUALITY", "API_TOKEN", "HOME"],
    });
    const environment = sanitizeWorkerEnvironment(policy, {
      RENDER_QUALITY: "high",
      API_TOKEN: "secret",
      HOME: "/Users/navin",
      UNDECLARED: "hidden",
    });
    expect(environment.values).toEqual({
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      RENDER_QUALITY: "high",
      TZ: "UTC",
    });
    expect(() => {
      authorizeBrowserCapability(policy, {
        kind: "navigate",
        url: "https://evil.example/",
        studioOrigin: "http://127.0.0.1:4317",
      });
    }).toThrow(/outside the Studio origin/);
    expect(() => {
      authorizeBrowserCapability(policy, { kind: "popup", url: "https://example.test" });
    }).toThrow(/denied/);
    expect(() => {
      authorizeBrowserCapability(policy, { kind: "file-url", url: pathToFileURL(allowedFile).href });
    }).not.toThrow();
    expect(() => {
      authorizeBrowserCapability(policy, { kind: "clipboard", userGesture: false });
    }).toThrow(/user gesture/);
  });

  it("binds imported worker resources, pools, profiles, caches, and provenance to policy identity", async () => {
    const fixture = await fixtureRoots();
    const imported = createExecutableSecurityPolicy({
      projectId: "project-security-0003",
      trustClass: "imported_untrusted",
      importedExecutionEnabled: true,
      rootPolicies: fixture.policies,
    });
    const launch = createIsolatedWorkerLaunch({
      policy: imported,
      nodeExecutable: process.execPath,
      entryFile: path.join(fixture.source, "worker.mjs"),
      environment: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
    });
    expect(launch.executable).toBe("/usr/bin/sandbox-exec");
    expect(launch.arguments.join(" ")).toContain("--permission");
    expect(launch.enforcementMechanisms).toContain("child-and-worker-denial");
    const provenance = artifactProvenance({
      artifactHash: sha("artifact"),
      policy: imported,
      environmentIdentity: sha("environment"),
      launch,
    });
    expect(() => {
      assertArtifactProvenanceCompatible(provenance, imported);
    }).not.toThrow();
    const trusted = createExecutableSecurityPolicy({
      projectId: "project-security-0003",
      trustClass: "trusted_authored",
      importedExecutionEnabled: false,
      rootPolicies: fixture.policies,
    });
    expect(() => {
      assertArtifactProvenanceCompatible(provenance, trusted);
    }).toThrow(/cannot cross trust/);
    expect(() => {
      assertResourceUsage(imported, { ...imported.limits, wallTimeMs: imported.limits.wallTimeMs + 1 });
    }).toThrow(/wallTimeMs/);
  });

  it("uses single-use operation-and-target authorization and prohibits publishing", () => {
    const registry = new DestructiveAuthorizationRegistry();
    const issued = registry.issue({
      id: "authorization-security-0001",
      operation: "cache.cleanup",
      projectId: "project-security-0004",
      targetIds: ["cache-preview"],
      issuedBy: "actor-security-0001",
      issuedAt: new Date("2026-07-16T00:00:00.000Z"),
      expiresAt: new Date("2026-07-16T00:10:00.000Z"),
    });
    expect(() =>
      registry.consume({
        id: issued.id,
        operation: "cache.cleanup",
        projectId: issued.projectId,
        targetIds: ["cache-other"],
        now: new Date("2026-07-16T00:01:00.000Z"),
      }),
    ).toThrow(/scope mismatch/);
    expect(
      registry.consume({
        id: issued.id,
        operation: "cache.cleanup",
        projectId: issued.projectId,
        targetIds: ["cache-preview"],
        now: new Date("2026-07-16T00:01:00.000Z"),
      }).consumedAt,
    ).toBe("2026-07-16T00:01:00.000Z");
    expect(() =>
      registry.consume({
        id: issued.id,
        operation: "external.publish",
        projectId: issued.projectId,
        targetIds: ["cache-preview"],
        now: new Date("2026-07-16T00:02:00.000Z"),
      }),
    ).toThrow(/unsupported/);
  });
});

const fixtureRoots = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-security-policy-"));
  temporaryDirectories.push(root);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  const temp = path.join(root, "temp");
  await Promise.all([mkdir(source), mkdir(output), mkdir(temp)]);
  return {
    source,
    policies: [
      { id: "source-root", path: source, mode: "read-only" as const },
      { id: "output-root", path: output, mode: "output-only" as const },
      { id: "temp-root", path: temp, mode: "temporary" as const },
    ],
  };
};

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

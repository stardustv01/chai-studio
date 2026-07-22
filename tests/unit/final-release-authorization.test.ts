import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  approvalStatementFor,
  approvalIdentity,
  acceptanceGateReportIdentity,
  assertPublicDistributionReview,
  assertOwnerApproval,
  publicDistributionReviewIdentity,
  unsignedReceiptBytes,
  verifyAcceptanceGateReportIdentity,
  verifySignedReleaseReceipt,
} from "../../scripts/release-approval.mjs";
import { assertPostFreezeAuthorityChanges } from "../../scripts/release-bundle.mjs";
import { resolveReleaseTarget } from "../../scripts/release-target.mjs";
import { assertReleaseTag } from "../../scripts/validate-release-tag.mjs";

const approval = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0-rc.4",
  distribution: "public",
  approved: true,
  inferred: false,
  owner: "Release owner",
  approvedAt: "2026-07-16T00:00:00.000Z",
  statement: approvalStatementFor("1.0.0-rc.4", "public"),
} as const;

describe("P28 explicit release authorization", () => {
  it("keeps the protected release gate real, read-only, and owner-authority preserving", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const taskGraphValidator = readFileSync(
      new URL("../../scripts/validate-task-graph.mjs", import.meta.url),
      "utf8",
    );
    const contractValidator = readFileSync(
      new URL("../../scripts/validate-contract-index.mjs", import.meta.url),
      "utf8",
    );
    const signer = readFileSync(new URL("../../scripts/sign-p28-release.mjs", import.meta.url), "utf8");
    const finalValidator = readFileSync(
      new URL("../../scripts/validate-p28-final-contract.mjs", import.meta.url),
      "utf8",
    );
    const releaseBundle = readFileSync(new URL("../../scripts/release-bundle.mjs", import.meta.url), "utf8");
    const cliRuntimeBuilder = readFileSync(
      new URL("../../scripts/build-cli-runtime.mjs", import.meta.url),
      "utf8",
    );
    const p27ManifestGenerator = readFileSync(
      new URL("../../scripts/generate-p27-release-manifest.mjs", import.meta.url),
      "utf8",
    );
    const p28ManifestGenerator = readFileSync(
      new URL("../../scripts/generate-p28-version-manifest.mjs", import.meta.url),
      "utf8",
    );
    const gateRunner = readFileSync(
      new URL("../../scripts/run-acceptance-gate.mjs", import.meta.url),
      "utf8",
    );
    const releaseTargetSource = readFileSync(
      new URL("../../scripts/release-target.mjs", import.meta.url),
      "utf8",
    );
    const protectedReleaseJob = workflow.slice(workflow.indexOf("  release-gate:"));
    const governanceCheck = manifest.scripts?.["release:governance:check"] ?? "";
    const releaseBuild = manifest.scripts?.["release:build"] ?? "";

    expect(workflow).not.toContain('run: echo "All required');
    expect(workflow).toContain("pnpm release:bundle -- --source-manifest evidence/p27/release-manifest.json");
    expect(workflow).toContain("pnpm release:bundle:verify");
    expect(workflow).toContain("pnpm release:tag:check");
    expect(protectedReleaseJob).toContain("if: startsWith(github.ref, 'refs/tags/v')");
    expect(protectedReleaseJob).not.toContain("github.event_name == 'workflow_dispatch'");
    expect(protectedReleaseJob).toContain("pnpm exec playwright install chromium");
    expect(protectedReleaseJob).toContain("run: pnpm release:build");
    expect(protectedReleaseJob.indexOf("run: pnpm release:build")).toBeLessThan(
      protectedReleaseJob.indexOf("pnpm release:bundle --"),
    );
    expect(protectedReleaseJob.indexOf("run: pnpm release:tag:check")).toBeLessThan(
      protectedReleaseJob.indexOf("Install FFmpeg runtime"),
    );
    expect(releaseBuild).toContain("tsc -b --force");
    expect(workflow).toContain("pnpm release:governance:check");
    expect(protectedReleaseJob).toContain("CHAI_STUDIO_PLANNING_ROOT: governance/planning-baseline");
    expect(workflow).toContain("pnpm p28:technical-contract");
    expect(workflow).toContain("generate-p28-version-manifest.mjs --check");
    expect(workflow).toContain("validate-p28-final-contract.mjs --require-final-gate");
    expect(governanceCheck).toContain("validate-task-graph.mjs --check");
    expect(governanceCheck).toContain("validate-contract-index.mjs --check");
    expect(governanceCheck).toContain("validate-source-license.mjs");
    expect(governanceCheck).toContain("generate-p23-license-inventory.mjs --check");
    expect(governanceCheck).toContain("run-isolation-spike.mjs --check");
    expect(governanceCheck).toContain("generate-p27-release-manifest.mjs --check");
    expect(governanceCheck).not.toMatch(/sign-p28|V1_OWNER_APPROVAL|releaseAuthorized/iu);
    expect(taskGraphValidator).toContain('process.argv.includes("--write")');
    expect(taskGraphValidator).toContain("process.env.CHAI_STUDIO_PLANNING_ROOT");
    expect(contractValidator).toContain('process.argv.includes("--write")');
    expect(signer).toContain("verifyAcceptanceGateReportIdentity(finalGate)");
    expect(finalValidator).toContain("verifyAcceptanceGateReportIdentity(finalGate ?? {})");
    expect(gateRunner).toContain("identity: acceptanceGateReportIdentity(reportBody)");
    expect(releaseTargetSource).toContain("packages/diagnostics/src/release-identity.json");
    expect(releaseTargetSource).not.toContain("packages/diagnostics/dist/release.js");
    expect(releaseBundle).toContain('"--prefer-offline"');
    expect(releaseBundle).toContain('"--frozen-lockfile"');
    expect(releaseBundle).not.toContain('"--offline"');
    expect(releaseBundle).toContain("sanitizeDeployedNodeModules");
    expect(releaseBundle).toContain("assertNoHostPaths");
    expect(releaseBundle).toContain('"packages/cli/runtime/vendor/hyperframes"');
    expect(releaseBundle).toContain('"vendor/hyperframes/cli.js"');
    expect(releaseBundle).toContain("assertEmbeddedHyperframesCliStarts");
    expect(releaseBundle).toContain("stdout.trimEnd()");
    expect(cliRuntimeBuilder).toContain("absWorkingDir: root");
    expect(p27ManifestGenerator).toContain('new Set([".tsbuildinfo"])');
    expect(p28ManifestGenerator).toContain('new Set([".tsbuildinfo"])');
    expect(p27ManifestGenerator).toContain('"governance/planning-baseline"');
    expect(p28ManifestGenerator).toContain('"governance/planning-baseline"');
  });

  it("permits an evidence-only authority commit but rejects post-freeze source drift", () => {
    expect(() => {
      assertPostFreezeAuthorityChanges([
        "evidence/p27/release-manifest.json",
        "evidence/p28/version-1-release-receipt.json",
        "governance/V1_OWNER_APPROVAL.json",
        "governance/licenses/public-distribution-review.json",
      ]);
    }).not.toThrow();
    expect(() => {
      assertPostFreezeAuthorityChanges(["package.json"]);
    }).toThrow(/post-freeze source changes/iu);
    expect(() => {
      assertPostFreezeAuthorityChanges(["scripts/sign-p28-release.mjs"]);
    }).toThrow(/post-freeze source changes/iu);
  });

  it("binds the exact package version to its diagnostics channel", () => {
    expect(
      resolveReleaseTarget({
        packageManifest: { version: "1.0.0-rc.4" },
        releaseIdentity: {
          product: "Chai Studio",
          version: "1.0.0-rc.4",
          channel: "release-candidate",
        },
      }),
    ).toEqual({
      version: "1.0.0-rc.4",
      channel: "release-candidate",
      releaseTag: "v1.0.0-rc.4",
      distribution: "public",
    });
    expect(() =>
      resolveReleaseTarget({
        packageManifest: { version: "1.0.0-rc.4" },
        releaseIdentity: {
          product: "Chai Studio",
          version: "1.0.0",
          channel: "stable",
          comment: 'version: "1.0.0-rc.4", channel: "release-candidate"',
          duplicate: { version: "1.0.0-rc.4", channel: "release-candidate" },
        },
      }),
    ).toThrow(/identities/iu);
  });

  it("requires the exact candidate tag ref", () => {
    expect(
      assertReleaseTag({
        packageManifest: { version: "1.0.0-rc.4" },
        refType: "tag",
        refName: "v1.0.0-rc.4",
      }),
    ).toBe("v1.0.0-rc.4");
    expect(() => {
      assertReleaseTag({
        packageManifest: { version: "1.0.0-rc.4" },
        refType: "branch",
        refName: "v1.0.0-rc.4",
      });
    }).toThrow(/exact Git tag/iu);
    expect(() => {
      assertReleaseTag({
        packageManifest: { version: "1.0.0-rc.4" },
        refType: "tag",
        refName: "v1.0.0-rc.3",
      });
    }).toThrow(/exact Git tag/iu);
  });

  it("rejects missing, inferred, ambiguous, and malformed approval", () => {
    expect(() => assertOwnerApproval(null)).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, inferred: true })).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, statement: "Continue automatically." })).toThrow(
      /explicit/iu,
    );
    expect(() =>
      assertOwnerApproval({
        ...approval,
        statement: "I do not authorize Chai Studio 1.0.0-rc.4 for public release.",
      }),
    ).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, approvedAt: "not-a-date" })).toThrow(/explicit/iu);
  });

  it("requires an exact public-distribution review for the candidate inventory", () => {
    const review = {
      schemaVersion: "1.0.0",
      product: "Chai Studio",
      version: "1.0.0-rc.4",
      trigger: "public-distribution",
      decision: "approved-public-distribution",
      reviewer: "License reviewer",
      reviewedAt: "2026-07-21T00:00:00.000Z",
      inventoryIdentity: "a".repeat(64),
      noticesAndObligations: ["Ship the reviewed notices."],
      reReviewCondition: "Dependency or distribution change.",
    } as const;
    expect(
      assertPublicDistributionReview(review, {
        version: review.version,
        inventoryIdentity: review.inventoryIdentity,
      }),
    ).toEqual(review);
    expect(() =>
      assertPublicDistributionReview(review, {
        version: review.version,
        inventoryIdentity: "b".repeat(64),
      }),
    ).toThrow(/public-distribution/iu);
    expect(
      publicDistributionReviewIdentity(review, {
        version: review.version,
        inventoryIdentity: review.inventoryIdentity,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("recomputes acceptance-gate identities and rejects a mutated report", () => {
    const report = {
      phase: "P28",
      taskRange: "P28.01-P28.20",
      passed: true,
      environment: {
        platform: "darwin",
        architecture: "arm64",
        node: "v22.17.0",
        lockfileSha256: "a".repeat(64),
        browserExecutable: "/managed/chromium",
        browserIdentity: "playwright-managed:chromium-1228",
        engineExecutable: "/managed/headless-shell",
        engineIdentity: "playwright-managed:chromium_headless_shell-1228",
      },
      implementationFiles: { "package.json": "b".repeat(64) },
      results: [{ name: "contract", passed: true, exitCode: 0 }],
    };
    const identified = { ...report, identity: acceptanceGateReportIdentity(report) };
    expect(verifyAcceptanceGateReportIdentity(identified)).toBe(true);
    expect(
      verifyAcceptanceGateReportIdentity({
        ...identified,
        results: [{ name: "contract", passed: false, exitCode: 0 }],
      }),
    ).toBe(false);
    const failedReport = {
      ...report,
      passed: false,
      results: [{ name: "contract", passed: false, exitCode: 1 }],
    };
    const identifiedFailure = {
      ...failedReport,
      identity: acceptanceGateReportIdentity(failedReport),
    };
    expect(verifyAcceptanceGateReportIdentity(identifiedFailure)).toBe(false);
    expect(verifyAcceptanceGateReportIdentity({ ...identifiedFailure, passed: true })).toBe(false);
  });

  it("accepts only the exact explicit owner approval contract", () => {
    const reorderedApproval = {
      statement: approval.statement,
      approvedAt: approval.approvedAt,
      owner: approval.owner,
      inferred: approval.inferred,
      approved: approval.approved,
      version: approval.version,
      distribution: approval.distribution,
      product: approval.product,
      schemaVersion: approval.schemaVersion,
    } as const;
    expect(assertOwnerApproval(approval)).toEqual(approval);
    expect(approvalIdentity(approval)).toMatch(/^[a-f0-9]{64}$/u);
    expect(approvalIdentity(reorderedApproval)).toBe(approvalIdentity(approval));
  });

  it("verifies the exact authorized receipt and rejects post-signature mutation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const dependencyInventoryIdentity = "a".repeat(64);
    const distributionReviewIdentity = "b".repeat(64);
    const payload = {
      version: "1.0.0-rc.4",
      candidate: "1.0.0-rc.4",
      distribution: "public",
      ownerApproval: { status: "explicitly-approved", inferred: false },
      dependencyInventoryIdentity,
      dependencyInventorySha256: "c".repeat(64),
      publicDistributionReviewIdentity: distributionReviewIdentity,
      publicDistributionReviewSha256: "d".repeat(64),
      publicDistributionReview: {
        status: "approved-public-distribution",
        inventoryIdentity: dependencyInventoryIdentity,
        reviewIdentity: distributionReviewIdentity,
      },
      signature: null,
      releaseAuthorized: true,
      releaseTagAuthorized: true,
    };
    const signature = sign(null, unsignedReceiptBytes(payload), privateKey).toString("base64");
    const receipt = { ...payload, signature: { algorithm: "Ed25519", value: signature } };
    expect(verifySignedReleaseReceipt(receipt, publicKey)).toBe(true);
    expect(verifySignedReleaseReceipt({ ...receipt, version: "1.0.1" }, publicKey)).toBe(false);
    expect(
      verifySignedReleaseReceipt({ ...receipt, publicDistributionReviewIdentity: "e".repeat(64) }, publicKey),
    ).toBe(false);
  });
});

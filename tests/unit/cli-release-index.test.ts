import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyReleaseRecord } from "../../packages/cli/lib/installer.mjs";
import { buildCliReleaseIndex } from "../../scripts/cli-release-index.mjs";
import { unsignedReceiptBytes } from "../../scripts/release-approval.mjs";

describe("CLI release index generation", () => {
  it("binds an immutable archive to an owner-authorized final receipt", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const sourceCommit = "a".repeat(40);
    const bundleIdentity = "b".repeat(64);
    const dependencyInventoryIdentity = "d".repeat(64);
    const dependencyInventorySha256 = "e".repeat(64);
    const publicDistributionReviewIdentity = "f".repeat(64);
    const publicDistributionReviewSha256 = "1".repeat(64);
    const p27Manifest = identified({
      schemaVersion: "1.0.0",
      product: "Chai Studio",
      version: "1.0.0-rc.4",
      sourceCommit,
      licenseInventorySha256: dependencyInventorySha256,
      runtimeBundle: { bundleIdentity },
    });
    const finalManifest = identified({
      schemaVersion: "1.0.0",
      product: "Chai Studio",
      version: "1.0.0-rc.4",
      dependencyInventoryIdentity,
      dependencyInventorySha256,
      publicDistributionReviewIdentity,
      publicDistributionReviewSha256,
      releaseAuthorized: false,
    });
    const unsignedReceipt = {
      schemaVersion: "1.0.0",
      product: "Chai Studio",
      version: "1.0.0-rc.4",
      candidate: "1.0.0-rc.4",
      distribution: "public",
      releaseManifestIdentity: p27Manifest.manifestIdentity,
      finalManifestIdentity: finalManifest.manifestIdentity,
      finalGateIdentity: "f".repeat(64),
      ownerApproval: { status: "explicitly-approved", inferred: false },
      dependencyInventoryIdentity,
      dependencyInventorySha256,
      publicDistributionReviewIdentity,
      publicDistributionReviewSha256,
      publicDistributionReview: {
        status: "approved-public-distribution",
        inventoryIdentity: dependencyInventoryIdentity,
        reviewIdentity: publicDistributionReviewIdentity,
      },
      releaseAuthorized: true,
      releaseTagAuthorized: true,
      signature: null,
    };
    const releaseReceipt = {
      ...unsignedReceipt,
      signature: {
        algorithm: "Ed25519",
        publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
        value: sign(null, unsignedReceiptBytes(unsignedReceipt), privateKey).toString("base64"),
      },
    };
    const archiveReceipt = {
      schemaVersion: "1.0.0",
      product: "Chai Studio",
      version: "1.0.0-rc.4",
      sourceCommit,
      bundleIdentity,
      bytes: 123,
      sha256: "c".repeat(64),
      releaseAuthorized: false,
    };

    const index = buildCliReleaseIndex({
      archiveReceipt,
      p27Manifest,
      finalManifest,
      releaseReceipt,
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      archiveUrl:
        "https://github.com/stardustv01/chai-studio/releases/download/v1.0.0-rc.4/chai-studio.tar.gz",
      keyId: "chai-studio-v1",
    });
    expect(index).toMatchObject({ latest: "1.0.0-rc.4", releases: [{ publishable: true }] });
    const [release] = index.releases;
    expect(release).toBeDefined();
    if (release === undefined) throw new Error("Expected one signed release record.");
    expect(verifyReleaseRecord(release, publicKey)).toBe(true);
    const contradictoryUnsignedReceipt = {
      ...unsignedReceipt,
      publicDistributionReviewIdentity: "2".repeat(64),
      publicDistributionReview: {
        ...unsignedReceipt.publicDistributionReview,
        reviewIdentity: "2".repeat(64),
      },
    };
    const contradictoryReceipt = {
      ...contradictoryUnsignedReceipt,
      signature: {
        algorithm: "Ed25519",
        publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
        value: sign(null, unsignedReceiptBytes(contradictoryUnsignedReceipt), privateKey).toString("base64"),
      },
    };
    expect(() =>
      buildCliReleaseIndex({
        archiveReceipt,
        p27Manifest,
        finalManifest,
        releaseReceipt: contradictoryReceipt,
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        archiveUrl: "https://example.test/chai.tar.gz",
        keyId: "chai-studio-v1",
      }),
    ).toThrow(/authority chain/iu);
    expect(() =>
      buildCliReleaseIndex({
        archiveReceipt: { ...archiveReceipt, sha256: "d".repeat(64) },
        p27Manifest,
        finalManifest,
        releaseReceipt: { ...releaseReceipt, finalGateIdentity: null },
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        archiveUrl: "https://example.test/chai.tar.gz",
        keyId: "chai-studio-v1",
      }),
    ).toThrow(/owner-authorized|final gate/u);
    expect(() =>
      buildCliReleaseIndex({
        archiveReceipt,
        p27Manifest,
        finalManifest,
        releaseReceipt: { ...releaseReceipt, version: "1.0.0" },
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        archiveUrl: "https://example.test/chai.tar.gz",
        keyId: "chai-studio-v1",
      }),
    ).toThrow(/owner-authorized|exact public archive candidate/u);
  });
});

const identified = (payload: Record<string, unknown>) => ({
  ...payload,
  manifestIdentity: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
});

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

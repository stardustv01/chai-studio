import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { URL } from "node:url";
import { signedReleaseBytes } from "../packages/cli/lib/installer.mjs";
import { verifySignedReleaseReceipt } from "./release-approval.mjs";

export const buildCliReleaseIndex = ({
  archiveReceipt,
  p27Manifest,
  finalManifest,
  releaseReceipt,
  publicKeyPem,
  privateKeyPem,
  archiveUrl,
  keyId,
}) => {
  assertHttps(archiveUrl);
  if (!verifySignedReleaseReceipt(releaseReceipt, publicKeyPem)) {
    throw new Error("A valid owner-authorized P28 release receipt is required.");
  }
  if (!/^[a-f0-9]{64}$/u.test(releaseReceipt.finalGateIdentity ?? "")) {
    throw new Error("The signed release receipt is not bound to a passing final gate.");
  }
  assertManifestIdentity(p27Manifest, "manifestIdentity", "P27 release manifest");
  assertManifestIdentity(finalManifest, "manifestIdentity", "Version 1 manifest");
  if (
    releaseReceipt.releaseManifestIdentity !== p27Manifest.manifestIdentity ||
    releaseReceipt.finalManifestIdentity !== finalManifest.manifestIdentity ||
    releaseReceipt.dependencyInventoryIdentity !== finalManifest.dependencyInventoryIdentity ||
    releaseReceipt.dependencyInventorySha256 !== finalManifest.dependencyInventorySha256 ||
    releaseReceipt.dependencyInventorySha256 !== p27Manifest.licenseInventorySha256 ||
    releaseReceipt.publicDistributionReviewIdentity !== finalManifest.publicDistributionReviewIdentity ||
    releaseReceipt.publicDistributionReviewSha256 !== finalManifest.publicDistributionReviewSha256 ||
    releaseReceipt.publicDistributionReview?.inventoryIdentity !==
      finalManifest.dependencyInventoryIdentity ||
    releaseReceipt.publicDistributionReview?.reviewIdentity !== finalManifest.publicDistributionReviewIdentity
  ) {
    throw new Error("The release authority chain does not match the supplied manifests.");
  }
  if (
    releaseReceipt.version !== archiveReceipt?.version ||
    releaseReceipt.candidate !== archiveReceipt?.version ||
    releaseReceipt.distribution !== "public" ||
    finalManifest.version !== archiveReceipt?.version ||
    p27Manifest.version !== archiveReceipt?.version
  ) {
    throw new Error("Release authority does not match the exact public archive candidate.");
  }
  if (
    archiveReceipt?.schemaVersion !== "1.0.0" ||
    archiveReceipt?.product !== "Chai Studio" ||
    archiveReceipt?.releaseAuthorized !== false ||
    archiveReceipt?.version !== p27Manifest?.version ||
    archiveReceipt?.sourceCommit !== p27Manifest?.sourceCommit ||
    archiveReceipt?.bundleIdentity !== p27Manifest?.runtimeBundle?.bundleIdentity ||
    archiveReceipt?.sha256 === undefined ||
    archiveReceipt?.bytes === undefined
  ) {
    throw new Error("Archive receipt does not match the P27 immutable runtime bundle.");
  }
  if (
    !/^[a-f0-9]{40}$/u.test(archiveReceipt.sourceCommit) ||
    !/^[a-f0-9]{64}$/u.test(archiveReceipt.bundleIdentity) ||
    !/^[a-f0-9]{64}$/u.test(archiveReceipt.sha256) ||
    !Number.isSafeInteger(archiveReceipt.bytes) ||
    archiveReceipt.bytes <= 0
  ) {
    throw new Error("Archive receipt identity is malformed.");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  const derivedPublicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const suppliedPublicKey = createPublicKey(publicKeyPem).export({ type: "spki", format: "pem" });
  if (derivedPublicKey !== suppliedPublicKey) {
    throw new Error("Release signing private key does not match the authorized public key.");
  }
  const publicKeySha256 = sha256(Buffer.from(suppliedPublicKey));
  if (releaseReceipt.signature?.publicKeySha256 !== publicKeySha256) {
    throw new Error("Authorized receipt signing key identity does not match the supplied key.");
  }
  if (typeof keyId !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(keyId)) {
    throw new Error("Release signing key ID is invalid.");
  }
  const unsigned = {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    version: archiveReceipt.version,
    platform: "darwin",
    architecture: "arm64",
    sourceCommit: archiveReceipt.sourceCommit,
    bundleIdentity: archiveReceipt.bundleIdentity,
    archiveUrl,
    archiveBytes: archiveReceipt.bytes,
    archiveSha256: archiveReceipt.sha256,
    releaseAuthorized: true,
    publishable: true,
  };
  const release = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519",
      keyId,
      publicKeySha256,
      value: sign(null, signedReleaseBytes(unsigned), privateKey).toString("base64"),
    },
  };
  return {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    latest: release.version,
    releases: [release],
  };
};

const assertManifestIdentity = (manifest, identityField, label) => {
  const expected = manifest?.[identityField];
  const payload = Object.fromEntries(Object.entries(manifest ?? {}).filter(([key]) => key !== identityField));
  if (!/^[a-f0-9]{64}$/u.test(expected ?? "") || sha256(Buffer.from(canonicalJson(payload))) !== expected) {
    throw new Error(`${label} identity is invalid.`);
  }
};

const assertHttps = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Release archive URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Release archive URL must use HTTPS.");
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

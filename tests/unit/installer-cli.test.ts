import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSafeArchiveEntries,
  fetchReleaseIndex,
  selectRelease,
  signedReleaseBytes,
  verifyReleaseRecord,
  type ReleaseIndex,
  type ReleaseRecord,
} from "../../packages/cli/lib/installer.mjs";

describe("registry-safe Chai Studio installer CLI", () => {
  it("selects only an authorized compatible release and verifies its Ed25519 signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const unsigned = releaseFixture();
    const release: ReleaseRecord = {
      ...unsigned,
      signature: {
        algorithm: "Ed25519",
        keyId: "test-release-key",
        publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
        value: sign(null, signedReleaseBytes(unsigned), privateKey).toString("base64"),
      },
    };
    const selected = selectRelease(indexFixture(release), {
      platform: "darwin",
      architecture: "arm64",
    });
    expect(selected.version).toBe("1.0.0-rc.4");
    expect(verifyReleaseRecord(selected, publicKey)).toBe(true);
    expect(() => verifyReleaseRecord({ ...selected, archiveBytes: 2 }, publicKey)).toThrow(/signature/u);
  });

  it("fails closed for unauthorized, unsigned, and unsupported release records", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const unsigned = releaseFixture();
    const signed: ReleaseRecord = {
      ...unsigned,
      signature: {
        algorithm: "Ed25519",
        keyId: "test-release-key",
        publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
        value: sign(null, signedReleaseBytes(unsigned), privateKey).toString("base64"),
      },
    };
    const malformed = unsigned as ReleaseRecord;
    expect(() =>
      selectRelease(indexFixture({ ...signed, releaseAuthorized: false }), {
        platform: "darwin",
        architecture: "arm64",
      }),
    ).toThrow(/not authorized/u);
    expect(() => selectRelease(indexFixture(signed), { platform: "linux", architecture: "arm64" })).toThrow(
      /No authorized/u,
    );
    expect(() => verifyReleaseRecord(malformed, "not a public key")).toThrow();
  });

  it("requires HTTPS before requesting a release index", async () => {
    let called = false;
    const fetchImplementation: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    };
    await expect(fetchReleaseIndex("http://example.test/releases.json", fetchImplementation)).rejects.toThrow(
      /must use HTTPS/u,
    );
    expect(called).toBe(false);
  });

  it("accepts one bundle root and rejects path traversal or multiple roots", () => {
    expect(assertSafeArchiveEntries("chai-studio-rc4/\nchai-studio-rc4/bin/chai-studio\n")).toBe(
      "chai-studio-rc4",
    );
    expect(() => assertSafeArchiveEntries("chai/../../outside\n")).toThrow(/unsafe path/u);
    expect(() => assertSafeArchiveEntries("/absolute/chai\n")).toThrow(/unsafe path/u);
    expect(() => assertSafeArchiveEntries("chai/file\nother/file\n")).toThrow(/one top-level/u);
  });
});

const releaseFixture = (): Omit<ReleaseRecord, "signature"> => ({
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0-rc.4",
  platform: "darwin",
  architecture: "arm64",
  sourceCommit: "a".repeat(40),
  bundleIdentity: "b".repeat(64),
  archiveUrl: "https://github.com/stardustv01/chai-studio/releases/download/v1.0.0-rc.4/chai.tgz",
  archiveBytes: 1,
  archiveSha256: "c".repeat(64),
  releaseAuthorized: true,
  publishable: true,
});

const indexFixture = (release: ReleaseRecord): ReleaseIndex => ({
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  latest: release.version,
  releases: [release],
});

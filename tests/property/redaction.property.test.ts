import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  redactText,
  redactTextWithContext,
  redactValue,
  redactValueWithContext,
  createSupportBundlePreviewManifest,
} from "../../packages/diagnostics/src/index.js";

describe("diagnostic redaction properties", () => {
  it("never retains generated token values or absolute macOS user roots", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9]{4,24}$/), (secret) => {
        const text = redactText(`token=${secret} path=/Users/navin/project.mov`);
        expect(text).not.toContain(secret);
        expect(text).not.toContain("/Users/navin");
        expect(redactValue({ apiKey: secret })).toEqual({ apiKey: "[REDACTED]" });
      }),
      { numRuns: 200 },
    );
  });

  it("redacts bearer tokens, PII, temp paths, and non-allowlisted environment while retaining project context", () => {
    const value = redactValueWithContext(
      {
        message:
          "Bearer abc.def user=navin@example.com /Users/navin/Studio/project/assets/clip.mov /private/tmp/secret/file",
        environment: { LANG: "C.UTF-8", PRIVATE_TOKEN: "secret", PATH: "/bin" },
      },
      { projectRoot: "/Users/navin/Studio/project", allowedEnvironmentKeys: ["LANG"] },
    );
    expect(JSON.stringify(value)).not.toContain("abc.def");
    expect(JSON.stringify(value)).not.toContain("navin@example.com");
    expect(JSON.stringify(value)).not.toContain("/private/tmp/secret/file");
    const record = value as Readonly<Record<string, unknown>>;
    expect(record.message).toEqual(expect.stringContaining("<project>/assets/clip.mov"));
    expect(record.environment).toEqual({
      LANG: "C.UTF-8",
      PRIVATE_TOKEN: "[REDACTED]",
      PATH: "[REDACTED]",
    });
    expect(redactTextWithContext("token=secret", {})).toBe("token=[REDACTED]");
    expect(() =>
      createSupportBundlePreviewManifest({
        createdByExplicitAction: false,
        includedRecordIds: ["diagnostic-record-0001"],
        metadata: {},
      }),
    ).toThrow(/explicit user action/);
    expect(
      createSupportBundlePreviewManifest({
        createdByExplicitAction: true,
        includedRecordIds: ["diagnostic-record-0001"],
        metadata: { token: "secret", source: "/Users/navin/Studio/project/source.ts" },
        context: { projectRoot: "/Users/navin/Studio/project" },
      }),
    ).toMatchObject({
      includeSourceMedia: false,
      includeExecutableSource: false,
      sanitizedMetadata: { token: "[REDACTED]", source: "<project>/source.ts" },
    });
  });
});

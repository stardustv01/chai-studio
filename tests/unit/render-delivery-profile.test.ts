import { describe, expect, it } from "vitest";
import {
  builtInDeliveryProfiles,
  preflightDeliveryRequest,
  validateDeliveryProfile,
  validateRenderScope,
} from "../../packages/render/src/index.js";

describe("delivery profile and render-scope contracts", () => {
  it("ships coherent identities for every required built-in delivery class", () => {
    const profiles = builtInDeliveryProfiles();
    expect(profiles.map((profile) => profile.kind)).toEqual([
      "youtube-1080p",
      "youtube-4k",
      "review-proxy",
      "shorts",
      "square",
      "transparent-overlay",
      "master-mezzanine",
      "still",
      "thumbnail",
      "image-sequence",
      "audio-only",
    ]);
    expect(profiles.every((profile) => validateDeliveryProfile(profile) === profile)).toBe(true);
  });

  it("rejects stale profile identities and invalid half-open ranges", () => {
    const base = builtInDeliveryProfiles()[0];
    if (base === undefined) throw new Error("Built-in delivery fixture is missing.");
    expect(() => validateDeliveryProfile({ ...base, width: 1280 })).toThrow(/stale identity/i);
    expect(() =>
      validateRenderScope({ kind: "selected-range", startFrame: "40", endFrameExclusive: "40" }),
    ).toThrow(/non-empty half-open/i);
  });

  it("blocks finals with missing originals, rights, dependencies, unsupported features, or disk", () => {
    const selected = builtInDeliveryProfiles()[0];
    if (selected === undefined) throw new Error("Built-in delivery fixture is missing.");
    const result = preflightDeliveryRequest({
      profile: selected,
      scope: { kind: "full-timeline" },
      timelineDurationFrames: "1200",
      hasMissingDependencies: true,
      hasUnsupportedCapabilities: true,
      hasUnclearedRights: true,
      originalsAvailable: false,
      diskBytesAvailable: 100,
      estimatedOutputBytes: 1_000,
    });
    expect(result.executable).toBe(false);
    expect(result.findings.filter((finding) => finding.blocking).map((finding) => finding.code)).toEqual([
      "delivery.dependencies.missing",
      "delivery.capability.unsupported",
      "delivery.rights.unresolved",
      "delivery.originals.missing",
      "delivery.disk.insufficient",
    ]);
  });
});

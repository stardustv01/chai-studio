import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCapabilityInspectorDescriptors,
  capabilityPreviewWarnings,
  capabilityStatuses,
  createCapabilityRegistry,
  initialCapabilityEntries,
  initialCapabilityRegistry,
  planCapabilityRender,
  selectCapabilityFallback,
  selectCapabilityUpgradeFixtures,
  type CapabilityEntry,
} from "../../packages/engine-adapters/src/index.js";

describe("P12 capability registry", () => {
  it("covers every accepted family and every explicit status with evidence-backed fixtures", async () => {
    expect(new Set(initialCapabilityRegistry.entries.map((entry) => entry.family))).toEqual(
      new Set([
        "typography",
        "media",
        "captions",
        "audio",
        "react",
        "html-css",
        "svg",
        "canvas",
        "lottie",
        "rive",
        "gsap",
        "waapi",
        "three-webgl",
        "shaders",
        "particles",
        "transitions",
        "alpha",
        "hdr-color-depth",
        "distributed-rendering",
      ]),
    );
    expect(new Set(initialCapabilityRegistry.entries.map((entry) => entry.status))).toEqual(
      new Set(capabilityStatuses),
    );
    for (const entry of initialCapabilityRegistry.entries) {
      expect(entry.owner).toBeTruthy();
      expect(entry.previewBehavior).toBeTruthy();
      expect(entry.renderBehavior).toBeTruthy();
      expect(entry.fixture.assertions.length).toBeGreaterThan(0);
      expect(entry.evidence.length).toBeGreaterThan(0);
      await expect(access(path.resolve(entry.fixture.testPath))).resolves.toBeUndefined();
    }
  });

  it("rejects unsupported, experimental, and fallback records that evade their policy", () => {
    const base = initialCapabilityEntries[0];
    if (base === undefined) throw new Error("Initial capability fixture is empty.");
    expect(() =>
      createCapabilityRegistry([{ ...base, capabilityId: "invalid.unsupported", status: "unsupported" }]),
    ).toThrow(/must block preview and render/);
    expect(() =>
      createCapabilityRegistry([{ ...base, capabilityId: "invalid.experimental", status: "experimental" }]),
    ).toThrow(/must require opt-in/);
    expect(() =>
      createCapabilityRegistry([
        {
          ...base,
          capabilityId: "invalid.fallback",
          status: "fallback_available",
          previewBehavior: "proxy",
          renderBehavior: "baked",
        },
      ]),
    ).toThrow(/requires a declared fallback/);
  });

  it("drives inspector, warnings, render planning, fallback, and upgrade fixtures from one change", () => {
    const original = initialCapabilityEntries.find(
      (entry) => entry.engine === "hyperframes" && entry.capabilityId === "hyperframes.gsap",
    );
    if (original === undefined) throw new Error("GSAP capability fixture is missing.");
    const changed: CapabilityEntry = {
      ...original,
      status: "fallback_available",
      previewBehavior: "proxy",
      renderBehavior: "baked",
      fallback: {
        fallbackId: "fallback.gsap-bake",
        kind: "baked",
        owner: "render-core",
        fidelity: "approximation",
        limitations: ["Live GSAP controls are unavailable."],
      },
    };
    const registry = createCapabilityRegistry(
      initialCapabilityEntries.map((entry) => (entry === original ? changed : entry)),
    );
    const capabilityRequest = {
      engine: "hyperframes" as const,
      capabilityId: "hyperframes.gsap",
    };
    const request = [capabilityRequest];
    expect(registry.registryId).not.toBe(initialCapabilityRegistry.registryId);
    expect(buildCapabilityInspectorDescriptors(registry, request)[0]).toMatchObject({
      status: "fallback_available",
      controlMode: "conversion-required",
    });
    expect(capabilityPreviewWarnings(registry, request)[0]).toMatchObject({
      code: "capability-fallback",
      severity: "warning",
    });
    expect(
      planCapabilityRender(registry, {
        ...capabilityRequest,
        experimentalOptIn: false,
      }),
    ).toMatchObject({
      action: "fallback",
      fallbackId: "fallback.gsap-bake",
      approximation: true,
    });
    expect(selectCapabilityFallback(registry, "hyperframes", "hyperframes.gsap")?.fallbackId).toBe(
      "fallback.gsap-bake",
    );
    expect(
      selectCapabilityUpgradeFixtures(registry, {
        changedEngines: ["hyperframes"],
        changedCapabilityIds: ["hyperframes.gsap"],
      }),
    ).toEqual([original.fixture.testPath]);
  });
});

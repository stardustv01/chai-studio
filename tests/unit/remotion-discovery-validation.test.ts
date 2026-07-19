import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRemotionInspectorDescriptor,
  discoverRemotionCompositions,
  pinnedRemotionVersion,
  remotionInspectorPropertyStates,
  validateRemotionSource,
} from "../../packages/engine-adapters/src/index.js";
import {
  FixtureRemotionRuntime,
  fixtureRuntimeComposition,
  sourceDescriptor,
} from "../fixtures/remotion-adapter-fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P10 Remotion discovery and validation", () => {
  it("discovers validated composition metadata and a safe prop schema without rendering", async () => {
    const fixture = await sourceFixture();
    const runtime = new FixtureRemotionRuntime();
    const report = await discoverRemotionCompositions({
      source: fixture.source,
      runtime,
      signal: new AbortController().signal,
    });
    expect(report).toMatchObject({
      valid: true,
      serveUrl: "fixture://remotion-bundle",
      selectedComposition: {
        compositionId: "FixtureComposition",
        width: 640,
        height: 360,
        fps: { numerator: "30", denominator: "1" },
        durationFrames: "60",
        adapterVersion: pinnedRemotionVersion,
      },
    });
    expect(runtime.calls).toEqual([`bundle:${fixture.entryPoint}`, "discover"]);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: "remotion.browser.info", compositionId: "discovery" }),
    ]);

    const selected = report.selectedComposition;
    expect(selected).not.toBeNull();
    const validation = await validateRemotionSource(fixture.source, selected);
    expect(validation).toMatchObject({
      valid: true,
      safeInputPropNames: ["title"],
      blockedInputPropNames: [],
    });
    if (selected === null) throw new Error("Fixture composition was not selected.");
    const inspector = createRemotionInspectorDescriptor({ composition: selected, validation });
    expect(inspector).toMatchObject({
      compositionId: "FixtureComposition",
      controls: [
        {
          propName: "title",
          label: "Title",
          control: "text",
          required: true,
          readOnly: false,
          value: "Calculated",
        },
      ],
      capabilityClassifications: { reactComponents: "native", programAudio: "unified" },
    });
    expect(remotionInspectorPropertyStates(inspector)["native.remotion.title"]).toMatchObject({
      value: "Calculated",
      ownership: "engine-native",
      capability: "native",
      safeToEdit: true,
    });
  });

  it("blocks unapproved delays, network access, dynamic code, unknown props, and version drift", async () => {
    const fixture = await sourceFixture(
      'export const C = () => { delayRender(); eval("x"); fetch("https://bad.example/file"); return Date.now(); };',
    );
    const source = {
      ...fixture.source,
      inputProps: { title: "Safe", unknown: true },
      expectedVersions: { ...fixture.source.expectedVersions, renderer: "4.0.488" },
    };
    const validation = await validateRemotionSource(source);
    expect(validation.valid).toBe(false);
    expect(validation.blockedInputPropNames).toContain("unknown");
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "remotion.version.unpinned",
        "remotion.props.unknown",
        "remotion.delay.not-approved",
        "remotion.source.dynamic-code",
        "remotion.source.nondeterministic-api",
        "remotion.network.unapproved",
      ]),
    );
  });

  it("rejects ambiguous composition selection and duplicate IDs", async () => {
    const fixture = await sourceFixture();
    const source = { ...fixture.source, compositionId: null };
    const runtime = new FixtureRemotionRuntime([
      fixtureRuntimeComposition,
      { ...fixtureRuntimeComposition },
      { ...fixtureRuntimeComposition, id: "SecondComposition" },
    ]);
    const report = await discoverRemotionCompositions({
      source,
      runtime,
      signal: new AbortController().signal,
    });
    expect(report.valid).toBe(false);
    expect(report.selectedComposition).toBeNull();
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "remotion.composition.duplicate-id",
        "remotion.composition.selection-ambiguous",
      ]),
    );
  });

  it("blocks discovery before bundling when the installed runtime drifts from the pinned version", async () => {
    const fixture = await sourceFixture();
    const runtime = new FixtureRemotionRuntime();
    Object.defineProperty(runtime, "versions", {
      value: { ...runtime.versions, renderer: "4.0.490" },
    });
    const report = await discoverRemotionCompositions({
      source: fixture.source,
      runtime,
      signal: new AbortController().signal,
    });
    expect(report.valid).toBe(false);
    expect(report.serveUrl).toBeNull();
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: "remotion.runtime.version-mismatch", severity: "error" }),
    ]);
    expect(runtime.calls).toEqual([]);
  });
});

const sourceFixture = async (componentSource = "export const FixtureComposition = () => null;") => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chai-remotion-source-"));
  directories.push(projectRoot);
  const entryPoint = path.join(projectRoot, "index.ts");
  const componentPath = path.join(projectRoot, "composition.tsx");
  await writeFile(entryPoint, 'export {FixtureComposition} from "./composition";\n');
  await writeFile(componentPath, componentSource);
  return {
    projectRoot,
    entryPoint,
    componentPath,
    source: sourceDescriptor({ projectRoot, entryPoint, componentPath }),
  };
};

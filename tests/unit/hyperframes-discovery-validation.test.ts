import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHyperframesInspectorDescriptor,
  discoverHyperframesCompositions,
  hyperframesInspectorPropertyStates,
  pinnedHyperframesVersion,
  validateHyperframesSource,
} from "../../packages/engine-adapters/src/index.js";
import {
  FixtureHyperframesRuntime,
  fixtureHtml,
  hyperframesSource,
} from "../fixtures/hyperframes-adapter-fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P11 HyperFrames discovery and validation", () => {
  it("discovers exact metadata, variables, tracks, timing, and active frame adapters", async () => {
    const fixture = await sourceFixture(
      '<script>window.__timelines={}; const timeline=gsap.timeline({paused:true}); window.__timelines["chai-fixture"]=timeline;</script>',
    );
    const runtime = new FixtureHyperframesRuntime();
    const discovery = await discoverHyperframesCompositions({
      source: fixture.source,
      runtime,
      signal: new AbortController().signal,
    });
    expect(discovery).toMatchObject({
      valid: true,
      selectedComposition: {
        compositionId: "chai-fixture",
        width: 640,
        height: 360,
        fps: { numerator: "30", denominator: "1" },
        durationFrames: "60",
        variables: [{ id: "title", value: "Fixture", safeToEdit: true }],
        frameAdapters: [{ kind: "gsap", seekable: true }],
      },
    });
    const composition = discovery.selectedComposition;
    if (composition === null) throw new Error("fixture composition missing");
    const validation = await validateHyperframesSource({
      source: fixture.source,
      composition,
      runtime,
      signal: new AbortController().signal,
    });
    expect(validation).toMatchObject({
      valid: true,
      seekable: true,
      safeVariableIds: ["title"],
      blockedVariableIds: [],
      workerPolicy: {
        trustClass: "trusted-authored",
        networkMode: "approved-only",
        nativeAudioAllowed: false,
      },
    });
    const inspector = createHyperframesInspectorDescriptor({ composition, validation });
    expect(inspector).toMatchObject({
      compositionId: "chai-fixture",
      variables: [{ id: "title", safeToEdit: true }],
      capabilityClassifications: { gsap: "native", programAudio: "unified" },
    });
    expect(hyperframesInspectorPropertyStates(inspector)["native.hyperframes.title"]).toMatchObject({
      value: "Fixture",
      ownership: "engine-native",
      capability: "native",
      safeToEdit: true,
    });
  });

  it("maps CLI source findings and blocks independent clocks, navigation, downloads, and unapproved network", async () => {
    const fixture = await sourceFixture(
      '<a download href="file">x</a><script>requestAnimationFrame(()=>{}); window.open("x"); location.assign("x"); fetch("https://bad.example/x")</script>',
    );
    const runtime = new FixtureHyperframesRuntime({
      checkPayload: {
        ok: false,
        lint: { findings: [] },
        runtime: {
          findings: [
            {
              code: "request_failed",
              severity: "error",
              message: "request failed",
              sourceFile: "index.html",
              selector: "#root",
              time: 1,
            },
          ],
        },
        _meta: { version: pinnedHyperframesVersion },
      },
    });
    const validation = await validateHyperframesSource({
      source: fixture.source,
      composition: null,
      runtime,
      signal: new AbortController().signal,
    });
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "hyperframes.network.unapproved",
        "hyperframes.policy.popup",
        "hyperframes.policy.navigation",
        "hyperframes.policy.download",
        "hyperframes.validation.independent-clock",
      ]),
    );
  });

  it("fails closed before invoking the CLI when source or runtime versions drift", async () => {
    const fixture = await sourceFixture();
    const runtime = new FixtureHyperframesRuntime({ version: "0.7.59" });
    const report = await discoverHyperframesCompositions({
      source: { ...fixture.source, expectedVersion: "0.7.59" },
      runtime,
      signal: new AbortController().signal,
    });
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["hyperframes.version.unpinned", "hyperframes.runtime.version-mismatch"]),
    );
    expect(runtime.calls).toEqual([]);
  });
});

const sourceFixture = async (body = "") => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-source-"));
  directories.push(projectRoot);
  await writeFile(path.join(projectRoot, "index.html"), fixtureHtml(body));
  await writeFile(path.join(projectRoot, "runtime.js"), "window.fixture = true;\n");
  return { projectRoot, source: hyperframesSource({ projectRoot }) };
};

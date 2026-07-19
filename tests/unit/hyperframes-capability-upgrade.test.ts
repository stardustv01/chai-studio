import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverHyperframesCompositions,
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

describe("P11 HyperFrames capability and upgrade fixture", () => {
  it("detects every accepted native adapter family behind seek-safe registration", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-capabilities-"));
    directories.push(projectRoot);
    const body = `<script>
window.__timelines = {};
const gsapTimeline = gsap.timeline({paused:true});
const lottieAnimation = lottie.loadAnimation({});
const threeScene = new THREE.Scene();
const riveAnimation = new Rive({});
document.body.animate([], {duration: 1000});
d3.select(document.body);
const pixiApplication = new PIXI.Application();
const fragmentShader = "void main(){gl_FragColor=vec4(1.0);}";
window.__hyperframes.registerFrameAdapter("fixture", {seek(){}});
window.__timelines["chai-fixture"] = gsapTimeline;
</script>`;
    await writeFile(path.join(projectRoot, "index.html"), fixtureHtml(body));
    await writeFile(path.join(projectRoot, "runtime.js"), "window.fixture = true;\n");
    const source = hyperframesSource({ projectRoot });
    const runtime = new FixtureHyperframesRuntime();
    const discovery = await discoverHyperframesCompositions({
      source,
      runtime,
      signal: new AbortController().signal,
    });
    const composition = discovery.selectedComposition;
    if (composition === null) throw new Error("capability fixture discovery failed");
    expect(composition.frameAdapters.map((adapter) => adapter.kind).sort()).toEqual([
      "custom",
      "d3",
      "gsap",
      "lottie",
      "pixijs",
      "rive",
      "shader",
      "three",
      "waapi",
    ]);
    expect(composition.frameAdapters.every((adapter) => adapter.seekable)).toBe(true);
    const validation = await validateHyperframesSource({
      source,
      composition,
      runtime,
      signal: new AbortController().signal,
      browserCheck: false,
    });
    expect(validation.seekable).toBe(true);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["hyperframes.validation.expensive-state"]),
    );
  });
});

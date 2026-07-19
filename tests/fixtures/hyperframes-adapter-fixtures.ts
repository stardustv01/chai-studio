import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  pinnedHyperframesVersion,
  type HyperframesCliEnvelope,
  type HyperframesCommandRuntime,
  type HyperframesProcessResult,
  type HyperframesSourceDescriptor,
} from "../../packages/engine-adapters/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { rgbaPng } from "./remotion-adapter-fixtures.js";

export class FixtureHyperframesRuntime implements HyperframesCommandRuntime {
  readonly version: string;
  readonly calls: string[] = [];
  readonly compositions: readonly Readonly<Record<string, unknown>>[];
  readonly lintPayload: HyperframesCliEnvelope;
  readonly checkPayload: HyperframesCliEnvelope;
  failCommand: string | null = null;

  constructor(
    input: {
      readonly version?: string;
      readonly compositions?: readonly Readonly<Record<string, unknown>>[];
      readonly lintPayload?: HyperframesCliEnvelope;
      readonly checkPayload?: HyperframesCliEnvelope;
    } = {},
  ) {
    this.version = input.version ?? pinnedHyperframesVersion;
    this.compositions = input.compositions ?? [
      { id: "chai-fixture", duration: 2, width: 640, height: 360, elementCount: 2 },
    ];
    this.lintPayload = input.lintPayload ?? meta({ ok: true, findings: [] });
    this.checkPayload =
      input.checkPayload ??
      meta({
        ok: true,
        lint: { findings: [] },
        runtime: { findings: [] },
        layout: { findings: [] },
        motion: { findings: [] },
        contrast: { findings: [] },
      });
  }

  runJson(
    command: string,
    arguments_: readonly string[],
    input: { readonly signal: AbortSignal },
  ): Promise<HyperframesCliEnvelope> {
    this.calls.push(`${command}:${arguments_.join(" ")}`);
    if (input.signal.aborted)
      return Promise.reject(new DOMException("fixture command cancelled", "AbortError"));
    if (this.failCommand === command) return Promise.reject(new Error(`fixture ${command} failure`));
    if (command === "compositions") return Promise.resolve(meta({ compositions: this.compositions }));
    if (command === "lint") return Promise.resolve(this.lintPayload);
    if (command === "check") return Promise.resolve(this.checkPayload);
    return Promise.reject(new Error(`unsupported fixture JSON command ${command}`));
  }

  async run(
    command: string,
    arguments_: readonly string[],
    input: { readonly signal: AbortSignal },
  ): Promise<HyperframesProcessResult> {
    this.calls.push(`${command}:${arguments_.join(" ")}`);
    if (input.signal.aborted) throw new DOMException("fixture command cancelled", "AbortError");
    if (this.failCommand === command) return { exitCode: 1, stdout: "", stderr: "fixture failure" };
    if (command === "render" && arguments_.includes("png-sequence")) {
      const outputIndex = arguments_.indexOf("--output");
      const output = arguments_[outputIndex + 1];
      if (output === undefined) throw new Error("fixture sequence output missing");
      await mkdir(output, { recursive: true });
      for (let frame = 0; frame < 60; frame += 1) {
        await writeFile(
          path.join(output, `frame-${frame.toString().padStart(4, "0")}.png`),
          rgbaPng(1, 1, [12, 34, 56, 255]),
        );
      }
      return { exitCode: 0, stdout: "sequence passed", stderr: "" };
    }
    if (command === "render") {
      const outputIndex = arguments_.indexOf("--output");
      const output = arguments_[outputIndex + 1];
      if (output === undefined) throw new Error("fixture render output missing");
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, "fixture full render");
      return { exitCode: 0, stdout: "render passed", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: `unsupported fixture command ${command}` };
  }
}

export const hyperframesSource = (input: {
  readonly projectRoot: string;
  readonly entryFile?: string;
  readonly trustClass?: "trusted-authored" | "imported-untrusted";
  readonly expectedVersion?: string;
  readonly variableOverrides?: Readonly<Record<string, unknown>>;
}): HyperframesSourceDescriptor => ({
  sourceId: "source-hyperframes-fixture-0001",
  projectRoot: input.projectRoot,
  entryFile: input.entryFile ?? path.join(input.projectRoot, "index.html"),
  compositionId: "chai-fixture",
  declaredFps: normalizeRational(30n, 1n),
  variableOverrides: input.variableOverrides ?? { title: "Fixture" },
  trustClass: input.trustClass ?? "trusted-authored",
  approvedNetworkResources: [],
  expectedVersion: input.expectedVersion ?? pinnedHyperframesVersion,
});

export const fixtureHtml = (body = ""): string => `<!doctype html>
<html><body>
<div id="root" data-composition-id="chai-fixture" data-width="640" data-height="360" data-duration="2" data-fps="30" data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"Default"}]'>
  <section class="clip" data-start="0" data-duration="2" data-track-index="1">Fixture</section>
</div>
<script src="./runtime.js"></script>${body}
</body></html>`;

const meta = <T extends Readonly<Record<string, unknown>>>(value: T): T & HyperframesCliEnvelope => ({
  ...value,
  _meta: {
    version: pinnedHyperframesVersion,
    latestVersion: pinnedHyperframesVersion,
    updateAvailable: false,
  },
});

import { describe, expect, it } from "vitest";
import {
  HyperframesPlayerHost,
  selectHyperframesWorkerPolicy,
  type HyperframesPlayerHandle,
} from "../../packages/engine-adapters/src/index.js";
import { runPreviewAdapterConformance, type PreviewLayerAdapter } from "../../packages/preview/src/index.js";
import { hyperframesSource } from "../fixtures/hyperframes-adapter-fixtures.js";

describe("P11 HyperFrames Player host", () => {
  it("seeks behind readiness, suppresses native audio, and reports scheduler-owned playback", async () => {
    const fixture = playerFixture();
    const host: PreviewLayerAdapter = fixture.host;
    const signal = new AbortController().signal;
    await host.preload({ startFrame: "0", endFrameExclusive: "20" }, signal);
    await host.presentFrame({
      schedulerSessionId: "scheduler-hf-seek-0001",
      frame: "12",
      presentationTimestamp: { numerator: "2", denominator: "5" },
      truthMode: "interactive-approximation",
      signal,
    });
    await host.beginSynchronizedPlayback({
      schedulerSessionId: "scheduler-hf-play-0002",
      startFrame: "12",
      startPresentationTimestamp: { numerator: "2", denominator: "5" },
      timelineFps: { numerator: "30", denominator: "1" },
      playRate: { numerator: "2", denominator: "1" },
      nativeAudioSuppressed: true,
      signal,
    });
    expect(fixture.handle.playOptions).toEqual({ playbackRate: 2, muted: true });
    expect(await host.reportPlaybackState("scheduler-hf-play-0002")).toMatchObject({
      observedFrame: "12",
      droppedFrames: 0,
    });
    await expect(host.reportPlaybackState("scheduler-stale-0003")).rejects.toThrow(/stale scheduler session/);
  });

  it("passes P09 conformance and preserves isolated worker policy through host creation", async () => {
    const result = await runPreviewAdapterConformance(() => playerFixture().host);
    expect(result.passed).toBe(true);
    expect(result.adapterVersion).toBe("0.7.58");
    const fixture = playerFixture();
    await fixture.host.preload({ startFrame: "0", endFrameExclusive: "2" }, new AbortController().signal);
    expect(fixture.createdPolicy?.trustClass).toBe("imported-untrusted");
    expect(fixture.createdPolicy?.networkMode).toBe("denied");
  });
});

const playerFixture = () => {
  const handle = new FixturePlayerHandle();
  const source = hyperframesSource({ projectRoot: "/project", trustClass: "imported-untrusted" });
  let createdPolicy: ReturnType<typeof selectHyperframesWorkerPolicy> | null = null;
  const host = new HyperframesPlayerHost({
    adapterId: "adapter-hyperframes-player-0001",
    layerId: "layer-hyperframes-player-0001",
    projectRoot: source.projectRoot,
    entryFile: source.entryFile,
    compositionId: "chai-fixture",
    variables: source.variableOverrides,
    fps: { numerator: "30", denominator: "1" },
    policy: selectHyperframesWorkerPolicy(source),
    factory: {
      create: (input) => {
        createdPolicy = input.policy;
        return Promise.resolve(handle);
      },
    },
  });
  return {
    host,
    handle,
    get createdPolicy() {
      return createdPolicy;
    },
  };
};

class FixturePlayerHandle implements HyperframesPlayerHandle {
  readonly calls: string[] = [];
  playOptions: Readonly<{ playbackRate: number; muted: true }> | null = null;
  #frame = 0;

  preload(range: Readonly<{ startFrame: string; endFrameExclusive: string }>): Promise<void> {
    this.calls.push(`preload:${range.startFrame}-${range.endFrameExclusive}`);
    return Promise.resolve();
  }
  pause(): Promise<void> {
    this.calls.push("pause");
    return Promise.resolve();
  }
  seekToFrame(frame: number): Promise<void> {
    this.#frame = frame;
    this.calls.push(`seek:${frame.toString()}`);
    return Promise.resolve();
  }
  waitUntilReady(frame: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
    this.calls.push(`ready:${frame.toString()}`);
    return Promise.resolve();
  }
  play(input: { readonly playbackRate: number; readonly muted: true }): Promise<void> {
    this.playOptions = input;
    return Promise.resolve();
  }
  currentFrame(): Promise<number> {
    return Promise.resolve(this.#frame);
  }
  droppedFrames(): Promise<number> {
    return Promise.resolve(0);
  }
  suspend(): Promise<void> {
    this.calls.push("suspend");
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    this.calls.push("destroy");
    return Promise.resolve();
  }
}

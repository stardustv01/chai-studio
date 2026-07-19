import { describe, expect, it } from "vitest";
import {
  RemotionPlayerHost,
  type RemotionPlayerFactory,
  type RemotionPlayerHandle,
} from "../../packages/engine-adapters/src/index.js";
import { runPreviewAdapterConformance, type PreviewLayerAdapter } from "../../packages/preview/src/index.js";

describe("P10 Remotion Player host", () => {
  it("seeks behind readiness, suppresses native audio, and reports scheduler-session playback", async () => {
    const fixture = playerFixture();
    const host: PreviewLayerAdapter = fixture.host;
    const controller = new AbortController();
    await host.preload({ startFrame: "0", endFrameExclusive: "20" }, controller.signal);
    const presented = await host.presentFrame({
      schedulerSessionId: "scheduler-seek-0001",
      frame: "12",
      presentationTimestamp: { numerator: "2", denominator: "5" },
      truthMode: "interactive-approximation",
      signal: controller.signal,
    });
    expect(presented).toMatchObject({
      frame: "12",
      ready: true,
      usedProxy: true,
      usedBakedFallback: false,
    });
    expect(fixture.handle.calls).toEqual(["preload:0-20", "pause", "seek:12", "ready:12", "current:12"]);

    await host.beginSynchronizedPlayback({
      schedulerSessionId: "scheduler-play-0002",
      startFrame: "12",
      startPresentationTimestamp: { numerator: "2", denominator: "5" },
      timelineFps: { numerator: "30", denominator: "1" },
      playRate: { numerator: "2", denominator: "1" },
      nativeAudioSuppressed: true,
      signal: controller.signal,
    });
    expect(fixture.handle.playOptions).toEqual({ playbackRate: 2, muted: true });
    expect(await host.reportPlaybackState("scheduler-play-0002")).toMatchObject({
      adapterId: "adapter-remotion-player-0001",
      schedulerSessionId: "scheduler-play-0002",
      observedFrame: "12",
      droppedFrames: 0,
    });
    await expect(host.reportPlaybackState("scheduler-stale-0003")).rejects.toThrow(/stale scheduler session/);
  });

  it("passes the reusable P09 adapter conformance harness", async () => {
    const result = await runPreviewAdapterConformance(() => playerFixture().host);
    expect(result.passed).toBe(true);
    expect(result.adapterVersion).toBe("4.0.489");
  });

  it("disposes the mounted Player exactly once and rejects later work", async () => {
    const fixture = playerFixture();
    await fixture.host.preload({ startFrame: "0", endFrameExclusive: "2" }, new AbortController().signal);
    await fixture.host.dispose();
    await fixture.host.dispose();
    expect(fixture.handle.calls.filter((call) => call === "destroy")).toHaveLength(1);
    await expect(
      fixture.host.preload({ startFrame: "0", endFrameExclusive: "2" }, new AbortController().signal),
    ).rejects.toThrow(/disposed/);
  });
});

const playerFixture = (): {
  readonly host: RemotionPlayerHost;
  readonly handle: FixturePlayerHandle;
} => {
  const handle = new FixturePlayerHandle();
  const factory: RemotionPlayerFactory = {
    create: () => Promise.resolve(handle),
  };
  return {
    handle,
    host: new RemotionPlayerHost({
      adapterId: "adapter-remotion-player-0001",
      layerId: "layer-remotion-player-0001",
      compositionId: "FixtureComposition",
      componentPath: "/project/composition.tsx",
      inputProps: { title: "Fixture" },
      factory,
    }),
  };
};

class FixturePlayerHandle implements RemotionPlayerHandle {
  readonly calls: string[] = [];
  playOptions: Readonly<{ playbackRate: number; muted: true }> | null = null;
  #frame = 0;

  preload(
    range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException("fixture preload aborted", "AbortError"));
    this.calls.push(`preload:${range.startFrame}-${range.endFrameExclusive}`);
    return Promise.resolve();
  }

  pause(): Promise<void> {
    this.calls.push("pause");
    return Promise.resolve();
  }

  seekTo(frame: number): Promise<void> {
    this.#frame = frame;
    this.calls.push(`seek:${frame.toString()}`);
    return Promise.resolve();
  }

  waitUntilReady(frame: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException("fixture readiness aborted", "AbortError"));
    this.calls.push(`ready:${frame.toString()}`);
    return Promise.resolve();
  }

  play(input: { readonly playbackRate: number; readonly muted: true }): Promise<void> {
    this.playOptions = input;
    this.calls.push(`play:${input.playbackRate.toString()}:muted`);
    return Promise.resolve();
  }

  currentFrame(): Promise<number> {
    this.calls.push(`current:${this.#frame.toString()}`);
    return Promise.resolve(this.#frame);
  }

  droppedFrames(): Promise<number> {
    this.calls.push("dropped:0");
    return Promise.resolve(0);
  }

  destroy(): Promise<void> {
    this.calls.push("destroy");
    return Promise.resolve();
  }
}

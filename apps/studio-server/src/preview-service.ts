import { randomUUID } from "node:crypto";
import {
  advancePreviewPlayback,
  applyPreviewControl,
  applyPreviewPreload,
  createPreviewSessionState,
  presentationTimestampForFrame,
  updatePreviewAdapterDiagnostics,
  type PreviewAdapterDiagnostics,
  type PreviewControl,
  type PreviewEngine,
  type PreviewSessionState,
} from "@chai-studio/preview";
import type { ProjectSessionService } from "./project-service.js";

export interface PreviewSessionStatus {
  readonly state: PreviewSessionState;
  readonly currentProjectRevisionId: string;
  readonly synchronized: boolean;
}

export type PreviewAdapterPreloader = (input: {
  readonly engine: PreviewEngine;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly currentFrame: string;
  readonly startFrame: string;
  readonly endFrame: string;
}) => Promise<PreviewAdapterDiagnostics>;

export class PreviewSessionService {
  readonly #projects: ProjectSessionService;
  readonly #now: () => Date;
  readonly #preloadAdapter: PreviewAdapterPreloader | undefined;
  readonly #listeners = new Set<(state: PreviewSessionState | null) => void>();
  #state: PreviewSessionState | null = null;
  #commandQueue: Promise<void> = Promise.resolve();
  #playbackTimer: NodeJS.Timeout | null = null;
  #lastTickNanoseconds: bigint | null = null;
  #tickRemainder = 0n;

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly now?: () => Date;
    readonly preloadAdapter?: PreviewAdapterPreloader;
  }) {
    this.#projects = input.projects;
    this.#now = input.now ?? (() => new Date());
    this.#preloadAdapter = input.preloadAdapter;
  }

  async load(): Promise<PreviewSessionStatus> {
    this.#stopPlaybackClock();
    const snapshot = await this.#projects.snapshot();
    const requiredEngines = requiredPreviewEngines(snapshot.timeline.tracks);
    this.#state = createPreviewSessionState({
      sessionId: `preview-${randomUUID()}`,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      timelineId: snapshot.timeline.timelineId,
      durationFrames: snapshot.timeline.durationFrames,
      timelineFps: snapshot.timeline.fps,
      requiredEngines,
      now: this.#timestamp(),
    });
    this.#emit(this.#state);
    return this.status();
  }

  async synchronize(): Promise<PreviewSessionStatus> {
    return this.#serialize(async () => {
      const previous = this.#state;
      if (previous === null) return this.load();
      this.#stopPlaybackClock();
      const snapshot = await this.#projects.snapshot();
      const duration = BigInt(snapshot.timeline.durationFrames);
      const previousFrame = BigInt(previous.currentFrame);
      const currentFrame = duration === 0n ? 0n : previousFrame >= duration ? duration - 1n : previousFrame;
      const loaded = createPreviewSessionState({
        sessionId: previous.sessionId,
        projectId: snapshot.project.projectId,
        revisionId: snapshot.pointer.revisionId,
        timelineId: snapshot.timeline.timelineId,
        durationFrames: snapshot.timeline.durationFrames,
        timelineFps: snapshot.timeline.fps,
        requiredEngines: requiredPreviewEngines(snapshot.timeline.tracks),
        now: this.#timestamp(),
      });
      this.#state = {
        ...loaded,
        currentFrame: currentFrame.toString(10),
        presentationTimestamp: presentationTimestampForFrame(
          currentFrame.toString(10),
          snapshot.timeline.fps,
        ),
        playRate: previous.playRate,
        loopRange: clampRange(previous.loopRange, duration),
        inOutRange: clampRange(previous.inOutRange, duration),
        quality: previous.quality,
        truthMode: previous.truthMode,
        approximationWarningVisible: previous.approximationWarningVisible,
        fidelityEquivalent: previous.fidelityEquivalent,
        stateVersion: previous.stateVersion + 1,
      };
      this.#emit(this.#state);
      return this.status();
    });
  }

  unload(): Readonly<{ unloaded: boolean; sessionId: string | null }> {
    this.#stopPlaybackClock();
    const sessionId = this.#state?.sessionId ?? null;
    this.#state = null;
    this.#emit(null);
    return { unloaded: sessionId !== null, sessionId };
  }

  async status(): Promise<PreviewSessionStatus> {
    const state = this.#requireState();
    const current = await this.#projects.snapshot();
    return {
      state,
      currentProjectRevisionId: current.pointer.revisionId,
      synchronized: current.pointer.revisionId === state.revisionId,
    };
  }

  async control(input: PreviewControl, expectedStateVersion: number): Promise<PreviewSessionStatus> {
    return this.#serialize(async () => {
      this.#assertStateVersion(expectedStateVersion);
      this.#state = applyPreviewControl(this.#requireState(), input, this.#timestamp());
      if (this.#state.transport === "playing") this.#startPlaybackClock();
      else this.#stopPlaybackClock();
      this.#emit(this.#state);
      return this.status();
    });
  }

  async preload(input: {
    readonly beforeFrames: number;
    readonly afterFrames: number;
    readonly expectedStateVersion: number;
  }): Promise<PreviewSessionStatus> {
    return this.#serialize(async () => {
      this.#assertStateVersion(input.expectedStateVersion);
      this.#state = applyPreviewPreload(
        this.#requireState(),
        { beforeFrames: input.beforeFrames, afterFrames: input.afterFrames },
        this.#timestamp(),
      );
      this.#emit(this.#state);
      const state = this.#requireState();
      const currentFrame = BigInt(state.currentFrame);
      const duration = BigInt(state.durationFrames);
      const startFrame = (
        currentFrame - BigInt(input.beforeFrames) < 0n ? 0n : currentFrame - BigInt(input.beforeFrames)
      ).toString(10);
      const endFrame = (
        duration === 0n
          ? 0n
          : currentFrame + BigInt(input.afterFrames) >= duration
            ? duration - 1n
            : currentFrame + BigInt(input.afterFrames)
      ).toString(10);
      if (this.#preloadAdapter !== undefined) {
        for (const engine of ["remotion", "hyperframes"] as const) {
          if (!state.adapters[engine].required) continue;
          const diagnostics = await this.#preloadAdapter({
            engine,
            projectId: state.projectId,
            revisionId: state.revisionId,
            timelineId: state.timelineId,
            currentFrame: state.currentFrame,
            startFrame,
            endFrame,
          });
          this.#state = updatePreviewAdapterDiagnostics(this.#requireState(), diagnostics, this.#timestamp());
          this.#emit(this.#state);
        }
      }
      return this.status();
    });
  }

  diagnostics(): Readonly<Record<PreviewEngine, PreviewAdapterDiagnostics>> {
    return this.#requireState().adapters;
  }

  subscribe(listener: (state: PreviewSessionState | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #assertStateVersion(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1) {
      throw new Error("Preview expected state version is invalid.");
    }
    const state = this.#requireState();
    if (state.stateVersion !== expected) {
      throw new Error(
        `Preview state conflict: expected ${String(expected)}, current ${String(state.stateVersion)}.`,
      );
    }
  }

  #requireState(): PreviewSessionState {
    if (this.#state === null) throw new Error("No preview session is loaded.");
    return this.#state;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #emit(state: PreviewSessionState | null): void {
    for (const listener of this.#listeners) listener(state === null ? null : structuredClone(state));
  }

  #startPlaybackClock(): void {
    if (this.#playbackTimer !== null) return;
    this.#lastTickNanoseconds = process.hrtime.bigint();
    this.#tickRemainder = 0n;
    this.#playbackTimer = setInterval(() => {
      this.#tickPlaybackClock();
    }, 16);
    this.#playbackTimer.unref();
  }

  #stopPlaybackClock(): void {
    if (this.#playbackTimer !== null) clearInterval(this.#playbackTimer);
    this.#playbackTimer = null;
    this.#lastTickNanoseconds = null;
    this.#tickRemainder = 0n;
  }

  #tickPlaybackClock(): void {
    const state = this.#state;
    const previousTick = this.#lastTickNanoseconds;
    if (state?.transport !== "playing" || previousTick === null) {
      this.#stopPlaybackClock();
      return;
    }
    const nowTick = process.hrtime.bigint();
    this.#lastTickNanoseconds = nowTick;
    const rateNumerator = BigInt(state.playRate.numerator);
    const rateDenominator = BigInt(state.playRate.denominator);
    const frameNumerator = BigInt(state.timelineFps.numerator);
    const frameDenominator = BigInt(state.timelineFps.denominator);
    const denominator = 1_000_000_000n * frameDenominator * rateDenominator;
    const numerator = (nowTick - previousTick) * frameNumerator * rateNumerator + this.#tickRemainder;
    const frameDelta = numerator / denominator;
    this.#tickRemainder = numerator % denominator;
    if (frameDelta === 0n) return;
    this.#state = advancePreviewPlayback(state, frameDelta, this.#timestamp());
    this.#emit(this.#state);
    if (this.#state.transport !== "playing") this.#stopPlaybackClock();
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#commandQueue.then(operation, operation);
    this.#commandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const requiredPreviewEngines = (
  tracks: readonly Readonly<{ readonly clips: readonly Readonly<{ readonly engine: string }>[] }>[],
): readonly PreviewEngine[] => {
  const engines = new Set<PreviewEngine>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.engine === "remotion" || clip.engine === "hyperframes") engines.add(clip.engine);
    }
  }
  return [...engines];
};

const clampRange = (
  range: PreviewSessionState["inOutRange"],
  duration: bigint,
): PreviewSessionState["inOutRange"] => {
  if (range === null || duration === 0n) return null;
  const start = BigInt(range.startFrame);
  const end = BigInt(range.endFrameExclusive);
  if (start >= duration) return null;
  return {
    startFrame: start.toString(10),
    endFrameExclusive: (end > duration ? duration : end).toString(10),
  };
};

export const previewTransportStates = [
  "stopped",
  "loading",
  "paused",
  "playing",
  "seeking",
  "buffering",
  "error",
  "disposed",
] as const;

export type PreviewTransportState = (typeof previewTransportStates)[number];

export type PreviewTransportEvent =
  | "load"
  | "ready"
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "buffer"
  | "resume"
  | "fail"
  | "recover"
  | "dispose";

const transitions: Readonly<
  Record<PreviewTransportState, Readonly<Partial<Record<PreviewTransportEvent, PreviewTransportState>>>>
> = {
  stopped: { load: "loading", play: "playing", seek: "seeking", dispose: "disposed", fail: "error" },
  loading: { ready: "paused", stop: "stopped", fail: "error", dispose: "disposed" },
  paused: {
    play: "playing",
    stop: "stopped",
    seek: "seeking",
    buffer: "buffering",
    fail: "error",
    dispose: "disposed",
  },
  playing: {
    pause: "paused",
    stop: "stopped",
    seek: "seeking",
    buffer: "buffering",
    fail: "error",
    dispose: "disposed",
  },
  seeking: {
    ready: "paused",
    play: "playing",
    buffer: "buffering",
    stop: "stopped",
    fail: "error",
    dispose: "disposed",
  },
  buffering: {
    resume: "playing",
    ready: "paused",
    seek: "seeking",
    stop: "stopped",
    fail: "error",
    dispose: "disposed",
  },
  error: { recover: "loading", stop: "stopped", dispose: "disposed" },
  disposed: {},
};

export class InvalidPreviewTransportTransitionError extends Error {
  readonly from: PreviewTransportState;
  readonly event: PreviewTransportEvent;

  constructor(from: PreviewTransportState, event: PreviewTransportEvent) {
    super(`Preview transport cannot apply ${event} while ${from}.`);
    this.name = "InvalidPreviewTransportTransitionError";
    this.from = from;
    this.event = event;
  }
}

export const transitionPreviewTransport = (
  current: PreviewTransportState,
  event: PreviewTransportEvent,
): PreviewTransportState => {
  const next = transitions[current][event];
  if (next === undefined) throw new InvalidPreviewTransportTransitionError(current, event);
  return next;
};

export const canTransitionPreviewTransport = (
  current: PreviewTransportState,
  event: PreviewTransportEvent,
): boolean => transitions[current][event] !== undefined;

export const previewTransportTransitions = transitions;

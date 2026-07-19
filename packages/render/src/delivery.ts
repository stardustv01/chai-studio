import { hashCanonicalRenderValue } from "./identity.js";

export type DeliveryProfileKind =
  | "youtube-1080p"
  | "youtube-4k"
  | "review-proxy"
  | "shorts"
  | "square"
  | "transparent-overlay"
  | "master-mezzanine"
  | "still"
  | "thumbnail"
  | "image-sequence"
  | "audio-only"
  | "custom";

export type DeliveryOutputKind = "video" | "still" | "image-sequence" | "audio";

export interface DeliveryProfile {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly name: string;
  readonly kind: DeliveryProfileKind;
  readonly purpose: "preview" | "final";
  readonly outputKind: DeliveryOutputKind;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: Readonly<{ numerator: string; denominator: string }> | null;
  readonly container: "mp4" | "mov" | "webm" | "png" | "jpeg" | "wav" | "flac";
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly audioSampleRate: 44_100 | 48_000 | 96_000 | null;
  readonly colorSpace: "rec709" | "display-p3" | "rec2020" | "source";
  readonly alpha: "none" | "straight" | "premultiplied";
  readonly sourcePolicy: "originals-required" | "proxies-allowed";
  readonly strictEnvironment: boolean;
  readonly outputPathTemplate: string;
  readonly identityHash: string;
}

export type RenderScope =
  | Readonly<{ kind: "full-timeline" }>
  | Readonly<{ kind: "in-out"; startFrame: string; endFrameExclusive: string }>
  | Readonly<{ kind: "selected-range"; startFrame: string; endFrameExclusive: string }>
  | Readonly<{ kind: "clip"; clipId: string; startFrame: string; endFrameExclusive: string }>
  | Readonly<{ kind: "frame"; frame: string }>
  | Readonly<{ kind: "named-version"; versionName: string; startFrame: string; endFrameExclusive: string }>;

export interface DeliveryPreflightFinding {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly blocking: boolean;
  readonly title: string;
  readonly detail: string;
  readonly repair: string | null;
}

export interface DeliveryPreflightResult {
  readonly schemaVersion: "1.0.0";
  readonly profile: DeliveryProfile;
  readonly scope: RenderScope;
  readonly executable: boolean;
  readonly findings: readonly DeliveryPreflightFinding[];
  readonly identityHash: string;
}

export type DeliveryProfileSeed = Omit<DeliveryProfile, "schemaVersion" | "identityHash">;

export const createDeliveryProfile = (seed: DeliveryProfileSeed): DeliveryProfile => {
  const base = { schemaVersion: "1.0.0" as const, ...seed };
  return { ...base, identityHash: hashCanonicalRenderValue(base) };
};

const common = {
  purpose: "final" as const,
  fps: { numerator: "30000", denominator: "1001" },
  audioCodec: "aac",
  audioSampleRate: 48_000 as const,
  colorSpace: "rec709" as const,
  alpha: "none" as const,
  sourcePolicy: "originals-required" as const,
  strictEnvironment: true,
};

export const builtInDeliveryProfiles = (): readonly DeliveryProfile[] => [
  createDeliveryProfile({
    ...common,
    id: "profile-youtube-1080p",
    name: "YouTube 1080p",
    kind: "youtube-1080p",
    outputKind: "video",
    width: 1920,
    height: 1080,
    container: "mp4",
    videoCodec: "h264",
    outputPathTemplate: "deliveries/{project}-{revision}-youtube-1080p.mp4",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-youtube-4k",
    name: "YouTube 4K",
    kind: "youtube-4k",
    outputKind: "video",
    width: 3840,
    height: 2160,
    container: "mp4",
    videoCodec: "h265",
    outputPathTemplate: "deliveries/{project}-{revision}-youtube-4k.mp4",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-review-proxy",
    name: "Review proxy",
    kind: "review-proxy",
    purpose: "preview",
    outputKind: "video",
    width: 1280,
    height: 720,
    container: "mp4",
    videoCodec: "h264",
    sourcePolicy: "proxies-allowed",
    strictEnvironment: false,
    outputPathTemplate: "reviews/{project}-{revision}-review.mp4",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-shorts-vertical",
    name: "Shorts 9:16",
    kind: "shorts",
    outputKind: "video",
    width: 1080,
    height: 1920,
    container: "mp4",
    videoCodec: "h264",
    outputPathTemplate: "deliveries/{project}-{revision}-shorts.mp4",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-square-social",
    name: "Square 1:1",
    kind: "square",
    outputKind: "video",
    width: 1080,
    height: 1080,
    container: "mp4",
    videoCodec: "h264",
    outputPathTemplate: "deliveries/{project}-{revision}-square.mp4",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-transparent-overlay",
    name: "Transparent overlay",
    kind: "transparent-overlay",
    outputKind: "video",
    width: 1920,
    height: 1080,
    container: "mov",
    videoCodec: "prores-4444",
    audioCodec: null,
    audioSampleRate: null,
    colorSpace: "source",
    alpha: "straight",
    outputPathTemplate: "deliveries/{project}-{revision}-overlay.mov",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-master-mezzanine",
    name: "Master mezzanine",
    kind: "master-mezzanine",
    outputKind: "video",
    width: 3840,
    height: 2160,
    container: "mov",
    videoCodec: "prores-422-hq",
    audioCodec: "pcm-s24le",
    colorSpace: "source",
    outputPathTemplate: "masters/{project}-{revision}-mezzanine.mov",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-still-png",
    name: "Still frame",
    kind: "still",
    outputKind: "still",
    width: 1920,
    height: 1080,
    fps: null,
    container: "png",
    videoCodec: "png",
    audioCodec: null,
    audioSampleRate: null,
    colorSpace: "source",
    outputPathTemplate: "stills/{project}-{revision}-{frame}.png",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-thumbnail-jpeg",
    name: "Thumbnail set",
    kind: "thumbnail",
    outputKind: "still",
    width: 1280,
    height: 720,
    fps: null,
    container: "jpeg",
    videoCodec: "mjpeg",
    audioCodec: null,
    audioSampleRate: null,
    outputPathTemplate: "thumbnails/{project}-{revision}-{frame}.jpg",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-png-sequence",
    name: "PNG image sequence",
    kind: "image-sequence",
    outputKind: "image-sequence",
    width: 1920,
    height: 1080,
    container: "png",
    videoCodec: "png",
    audioCodec: null,
    audioSampleRate: null,
    colorSpace: "source",
    outputPathTemplate: "sequences/{project}-{revision}/frame-{frame}.png",
  }),
  createDeliveryProfile({
    ...common,
    id: "profile-audio-wav",
    name: "Audio only",
    kind: "audio-only",
    outputKind: "audio",
    width: null,
    height: null,
    fps: null,
    container: "wav",
    videoCodec: null,
    audioCodec: "pcm-s24le",
    colorSpace: "source",
    outputPathTemplate: "audio/{project}-{revision}-mix.wav",
  }),
];

export const validateDeliveryProfile = (value: DeliveryProfile): DeliveryProfile => {
  const { identityHash, ...withoutIdentity } = value;
  const schemaVersion: unknown = (value as unknown as Readonly<Record<string, unknown>>).schemaVersion;
  const hasVideoDimensions =
    value.outputKind === "audio" ||
    (Number.isSafeInteger(value.width) &&
      (value.width ?? 0) >= 16 &&
      (value.width ?? 0) <= 16_384 &&
      Number.isSafeInteger(value.height) &&
      (value.height ?? 0) >= 16 &&
      (value.height ?? 0) <= 16_384);
  const validFps =
    value.fps === null ||
    (/^[1-9][0-9]*$/.test(value.fps.numerator) && /^[1-9][0-9]*$/.test(value.fps.denominator));
  const noTraversal =
    !value.outputPathTemplate.startsWith("/") &&
    !value.outputPathTemplate.split("/").includes("..") &&
    value.outputPathTemplate.length <= 512;
  const coherentAlpha =
    value.alpha === "none" ||
    (value.container === "mov" && value.videoCodec === "prores-4444") ||
    value.container === "png";
  if (
    schemaVersion !== "1.0.0" ||
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value.id) ||
    value.name.trim().length === 0 ||
    value.name.length > 128 ||
    !hasVideoDimensions ||
    !validFps ||
    !noTraversal ||
    !coherentAlpha ||
    (value.outputKind === "audio" && (value.videoCodec !== null || value.audioCodec === null)) ||
    (value.outputKind !== "audio" && value.videoCodec === null) ||
    (value.outputKind === "video" && value.fps === null) ||
    identityHash !== hashCanonicalRenderValue(withoutIdentity)
  )
    throw new Error("Delivery profile is invalid, incoherent, or has a stale identity.");
  return value;
};

export const validateRenderScope = (scope: RenderScope): RenderScope => {
  const assertFrame = (value: string): bigint => {
    if (!/^(0|[1-9][0-9]*)$/.test(value))
      throw new Error("Render scope frames must be non-negative integers.");
    return BigInt(value);
  };
  if (scope.kind === "full-timeline") return scope;
  if (scope.kind === "frame") {
    assertFrame(scope.frame);
    return scope;
  }
  if (scope.kind === "clip" && !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(scope.clipId)) {
    throw new Error("Render clip scope requires a stable clip ID.");
  }
  if (
    scope.kind === "named-version" &&
    (scope.versionName.trim().length === 0 || scope.versionName.length > 128)
  ) {
    throw new Error("Named render version requires a bounded name.");
  }
  if (assertFrame(scope.endFrameExclusive) <= assertFrame(scope.startFrame)) {
    throw new Error("Render scope must use a non-empty half-open frame range.");
  }
  return scope;
};

export const preflightDeliveryRequest = (input: {
  readonly profile: DeliveryProfile;
  readonly scope: RenderScope;
  readonly timelineDurationFrames: string;
  readonly hasMissingDependencies: boolean;
  readonly hasUnsupportedCapabilities: boolean;
  readonly hasUnclearedRights: boolean;
  readonly originalsAvailable: boolean;
  readonly diskBytesAvailable: number | null;
  readonly estimatedOutputBytes: number | null;
}): DeliveryPreflightResult => {
  validateDeliveryProfile(input.profile);
  validateRenderScope(input.scope);
  const findings: DeliveryPreflightFinding[] = [];
  const add = (finding: DeliveryPreflightFinding): void => {
    findings.push(finding);
  };
  if (input.hasMissingDependencies)
    add({
      code: "delivery.dependencies.missing",
      severity: "error",
      blocking: true,
      title: "Dependencies are missing",
      detail: "One or more assets, fonts, or engine dependencies cannot be resolved.",
      repair: "Relink or restore every required dependency.",
    });
  if (input.hasUnsupportedCapabilities)
    add({
      code: "delivery.capability.unsupported",
      severity: "error",
      blocking: true,
      title: "A capability is unsupported",
      detail: "The render plan contains a capability with no accepted path or fallback.",
      repair: "Replace the capability or accept a bounded fallback.",
    });
  if (input.hasUnclearedRights)
    add({
      code: "delivery.rights.unresolved",
      severity: "error",
      blocking: true,
      title: "Rights are unresolved",
      detail: "At least one delivery asset is not cleared for this output.",
      repair: "Attach proof or remove the asset from the delivery.",
    });
  if (input.profile.sourcePolicy === "originals-required" && !input.originalsAvailable)
    add({
      code: "delivery.originals.missing",
      severity: "error",
      blocking: true,
      title: "Original media is required",
      detail: "This final profile cannot render from proxy media.",
      repair: "Reconnect the original media before rendering.",
    });
  if (
    input.diskBytesAvailable !== null &&
    input.estimatedOutputBytes !== null &&
    input.diskBytesAvailable < input.estimatedOutputBytes * 1.2
  )
    add({
      code: "delivery.disk.insufficient",
      severity: "error",
      blocking: true,
      title: "Not enough disk space",
      detail: "Available space is below the output estimate plus the required safety margin.",
      repair: "Free space or choose another output location.",
    });
  if (input.profile.purpose === "preview" && input.profile.sourcePolicy === "proxies-allowed")
    add({
      code: "delivery.proxy.preview-only",
      severity: "warning",
      blocking: false,
      title: "Proxy sources are allowed",
      detail: "This review output is not final-source delivery evidence.",
      repair: null,
    });
  const duration = BigInt(input.timelineDurationFrames);
  const outside =
    input.scope.kind === "frame"
      ? BigInt(input.scope.frame) >= duration
      : input.scope.kind === "full-timeline"
        ? false
        : BigInt(input.scope.endFrameExclusive) > duration;
  if (outside)
    add({
      code: "delivery.scope.outside-timeline",
      severity: "error",
      blocking: true,
      title: "Range exceeds the timeline",
      detail: "The requested frame or range extends past the immutable timeline duration.",
      repair: "Choose a range inside the current timeline.",
    });
  if (findings.length === 0)
    add({
      code: "delivery.preflight.ready",
      severity: "info",
      blocking: false,
      title: "Ready to render",
      detail: "Profile, scope, dependencies, rights, sources, and disk checks passed.",
      repair: null,
    });
  const base = {
    schemaVersion: "1.0.0" as const,
    profile: input.profile,
    scope: input.scope,
    executable: !findings.some((finding) => finding.blocking),
    findings,
  };
  return { ...base, identityHash: hashCanonicalRenderValue(base as never) };
};

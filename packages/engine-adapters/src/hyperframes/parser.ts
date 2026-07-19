import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRational, type NormalizedRational } from "@chai-studio/schema";
import type {
  HyperframesFrameAdapterDescriptor,
  HyperframesFrameAdapterKind,
  HyperframesSourceDescriptor,
  HyperframesTrackDescriptor,
  HyperframesVariableDescriptor,
  HyperframesVariableType,
} from "./contracts.js";

export interface ParsedHyperframesSource {
  readonly sourcePath: string;
  readonly html: string;
  readonly compositions: readonly ParsedHyperframesComposition[];
  readonly frameAdapters: readonly HyperframesFrameAdapterDescriptor[];
  readonly externalUrls: readonly string[];
  readonly localReferences: readonly string[];
}

export interface ParsedHyperframesComposition {
  readonly id: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: NormalizedRational | null;
  readonly durationSeconds: number | null;
  readonly tracks: readonly HyperframesTrackDescriptor[];
  readonly timingAttributeCount: number;
  readonly variables: readonly HyperframesVariableDescriptor[];
}

export const parseHyperframesSource = async (
  source: HyperframesSourceDescriptor,
): Promise<ParsedHyperframesSource> => {
  const html = await readFile(source.entryFile, "utf8");
  const tags = [...html.matchAll(/<([a-z][\w:-]*)\b([^<>]*)>/gi)].map((match) => ({
    name: (match[1] ?? "").toLowerCase(),
    attributes: parseAttributes(match[2] ?? ""),
  }));
  const compositionTags = tags.filter((tag) => tag.attributes["data-composition-id"] !== undefined);
  const timingTags = tags.filter(
    (tag) =>
      tag.attributes["data-start"] !== undefined ||
      tag.attributes["data-duration"] !== undefined ||
      tag.attributes["data-end"] !== undefined ||
      tag.attributes["data-track-index"] !== undefined,
  );
  const trackMap = new Map<number, { count: number; start: number; end: number }>();
  for (const tag of timingTags) {
    const trackIndex = numberAttribute(tag.attributes["data-track-index"] ?? "0");
    if (trackIndex === null || !Number.isInteger(trackIndex) || trackIndex < 0) continue;
    const start = numberAttribute(tag.attributes["data-start"] ?? "0") ?? 0;
    const duration = numberAttribute(tag.attributes["data-duration"] ?? "0") ?? 0;
    const end = numberAttribute(tag.attributes["data-end"] ?? "") ?? start + duration;
    const previous = trackMap.get(trackIndex);
    trackMap.set(trackIndex, {
      count: (previous?.count ?? 0) + 1,
      start: Math.min(previous?.start ?? start, start),
      end: Math.max(previous?.end ?? end, end),
    });
  }
  const tracks = [...trackMap.entries()]
    .sort(([left], [right]) => left - right)
    .map(([trackIndex, track]) => ({
      trackIndex,
      elementCount: track.count,
      startSeconds: track.start,
      endSeconds: track.end,
    }));
  const compositions = compositionTags.map((tag) => ({
    id: tag.attributes["data-composition-id"] ?? "",
    width: integerAttribute(tag.attributes["data-width"]),
    height: integerAttribute(tag.attributes["data-height"]),
    fps: rationalAttribute(tag.attributes["data-fps"]),
    durationSeconds: numberAttribute(tag.attributes["data-duration"]),
    tracks,
    timingAttributeCount: timingTags.length,
    variables: parseVariables(tag.attributes["data-composition-variables"], source.variableOverrides),
  }));
  const references = extractReferences(html);
  return {
    sourcePath: path.resolve(source.entryFile),
    html,
    compositions,
    frameAdapters: detectFrameAdapters(html, source.entryFile),
    externalUrls: references.filter((reference) => /^https?:\/\//i.test(reference)),
    localReferences: references.filter(
      (reference) =>
        !/^(?:https?:|data:|blob:|#|mailto:|javascript:)/i.test(reference) && reference.trim() !== "",
    ),
  };
};

const parseAttributes = (source: string): Readonly<Record<string, string>> => {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined) attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
};

const parseVariables = (
  serialized: string | undefined,
  overrides: Readonly<Record<string, unknown>>,
): readonly HyperframesVariableDescriptor[] => {
  if (serialized === undefined || serialized.trim() === "") return [];
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): readonly HyperframesVariableDescriptor[] => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const variable = candidate as Readonly<Record<string, unknown>>;
    const id = typeof variable.id === "string" ? variable.id : "";
    const type = isVariableType(variable.type) ? variable.type : null;
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(id) || type === null) return [];
    const defaultValue = variable.default ?? null;
    const resolved = Object.hasOwn(overrides, id) ? overrides[id] : defaultValue;
    const safeToEdit = isSafeVariableValue(type, resolved);
    return [
      {
        id,
        label: typeof variable.label === "string" ? variable.label : id,
        type,
        defaultValue,
        value: resolved,
        safeToEdit,
        warning: safeToEdit ? null : "Variable value does not match its declared safe type.",
      },
    ];
  });
};

const detectFrameAdapters = (
  html: string,
  sourcePath: string,
): readonly HyperframesFrameAdapterDescriptor[] => {
  const detectors: readonly [HyperframesFrameAdapterKind, RegExp, boolean][] = [
    ["gsap", /\bgsap\b/i, true],
    ["lottie", /\b(?:lottie|bodymovin)\b/i, true],
    ["three", /\b(?:THREE|three(?:\.module)?)\b/, true],
    ["rive", /\b(?:rive|Rive)\b/, true],
    ["waapi", /\.animate\s*\(|\bAnimation\s*\(/, true],
    ["d3", /\bd3(?:\.|\b)/, true],
    ["pixijs", /\b(?:PIXI|pixi\.js)\b/i, true],
    ["shader", /\b(?:WebGL|fragmentShader|vertexShader|gl_FragColor)\b/, true],
    ["custom", /\b(?:registerFrameAdapter|data-frame-adapter)\b/, false],
  ];
  return detectors.flatMap(([kind, expression, frameworkSeekable]) =>
    expression.test(html)
      ? [
          {
            kind,
            adapterId: `hyperframes-${kind}`,
            seekable:
              frameworkSeekable || /\b(?:__timelines|registerFrameAdapter|data-frame-adapter)\b/.test(html),
            sourcePath,
          },
        ]
      : [],
  );
};

const extractReferences = (html: string): readonly string[] => {
  const references = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1] !== undefined) references.add(match[1]);
  }
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    if (match[1] !== undefined) references.add(match[1]);
  }
  for (const match of html.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/g)) {
    if (match[1] !== undefined) references.add(match[1]);
  }
  return [...references].sort();
};

const rationalAttribute = (value: string | undefined): NormalizedRational | null => {
  if (value === undefined) return null;
  if (/^[1-9][0-9]*\/[1-9][0-9]*$/.test(value)) {
    const [numerator, denominator] = value.split("/");
    if (numerator !== undefined && denominator !== undefined)
      return normalizeRational(BigInt(numerator), BigInt(denominator));
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const precision = 1_000_000n;
  return normalizeRational(BigInt(Math.round(numeric * Number(precision))), precision);
};

const integerAttribute = (value: string | undefined): number | null => {
  const number = numberAttribute(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
};

const numberAttribute = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isVariableType = (value: unknown): value is HyperframesVariableType =>
  value === "string" ||
  value === "number" ||
  value === "boolean" ||
  value === "color" ||
  value === "image" ||
  value === "video";

const isSafeVariableValue = (type: HyperframesVariableType, value: unknown): boolean => {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string" && value.length <= 16_384;
};

const decodeHtml = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  HyperframesDependencyEntry,
  HyperframesDependencySet,
  HyperframesFrameAdapterDescriptor,
  HyperframesSourceDescriptor,
} from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";
import { parseHyperframesSource } from "./parser.js";
import { selectHyperframesWorkerPolicy } from "./trust-policy.js";

export const collectHyperframesDependencies = async (
  source: HyperframesSourceDescriptor,
  compositionId: string,
): Promise<HyperframesDependencySet> => {
  const projectRoot = await realpath(source.projectRoot);
  const parsed = await parseHyperframesSource(source);
  const files = await collectFiles(source.entryFile, projectRoot);
  const entries: HyperframesDependencyEntry[] = [];
  for (const filePath of files) entries.push(await fileEntry(filePath, projectRoot));
  entries.push({
    kind: "variables",
    identity: `${source.sourceId}:${compositionId}:variables`,
    projectRelativePath: null,
    contentHash: sha256(canonicalJson(source.variableOverrides)),
  });
  entries.push({
    kind: "package",
    identity: "hyperframes",
    projectRelativePath: null,
    contentHash: sha256(pinnedHyperframesVersion),
  });
  for (const adapter of parsed.frameAdapters) entries.push(adapterEntry(adapter));
  for (const resource of [...source.approvedNetworkResources].sort((left, right) =>
    left.url.localeCompare(right.url),
  )) {
    if (!/^[a-f0-9]{64}$/.test(resource.contentHash))
      throw new Error(`HyperFrames approved resource ${resource.url} lacks a SHA-256 hash.`);
    entries.push({
      kind: "approved-network",
      identity: resource.url,
      projectRelativePath: null,
      contentHash: resource.contentHash,
    });
  }
  const sorted = entries.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity),
  );
  const policy = selectHyperframesWorkerPolicy(source);
  return {
    schemaVersion: "1.0.0",
    sourceId: source.sourceId,
    compositionId,
    trustClass: source.trustClass,
    cacheNamespace: policy.cacheNamespace,
    entries: sorted,
    dependencyGraphHash: sha256(
      canonicalJson({
        sourceId: source.sourceId,
        compositionId,
        trustClass: source.trustClass,
        cacheNamespace: policy.cacheNamespace,
        entries: sorted,
      }),
    ),
  };
};

const collectFiles = async (entryFile: string, projectRoot: string): Promise<readonly string[]> => {
  const visited = new Set<string>();
  const visit = async (candidate: string): Promise<void> => {
    const resolved = await resolveLocal(candidate);
    if (resolved === null || visited.has(resolved)) return;
    if (!isInside(resolved, projectRoot))
      throw new Error(`HyperFrames dependency escapes the project root: ${candidate}`);
    visited.add(resolved);
    const extension = path.extname(resolved).toLowerCase();
    if (!textExtensions.has(extension)) return;
    const source = await readFile(resolved, "utf8");
    for (const reference of extractReferences(source)) {
      if (/^(?:https?:|data:|blob:|#|mailto:|javascript:)/i.test(reference)) continue;
      await visit(path.resolve(path.dirname(resolved), reference.split(/[?#]/, 1)[0] ?? reference));
    }
  };
  await visit(entryFile);
  return [...visited].sort();
};

const extractReferences = (source: string): readonly string[] => {
  const values = new Set<string>();
  const expressions = [
    /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bfetch\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) if (match[1] !== undefined) values.add(match[1]);
  }
  return [...values];
};

const resolveLocal = async (candidate: string): Promise<string | null> => {
  const attempts = [candidate, ...textExtensions].map((extensionOrPath) =>
    extensionOrPath === candidate ? candidate : `${candidate}${extensionOrPath}`,
  );
  for (const attempt of attempts) {
    try {
      await access(attempt);
      return await realpath(attempt);
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
};

const fileEntry = async (filePath: string, projectRoot: string): Promise<HyperframesDependencyEntry> => {
  const extension = path.extname(filePath).toLowerCase();
  return {
    kind: kindFor(extension),
    identity: path.relative(projectRoot, filePath),
    projectRelativePath: path.relative(projectRoot, filePath),
    contentHash: sha256(await readFile(filePath)),
  };
};

const adapterEntry = (adapter: HyperframesFrameAdapterDescriptor): HyperframesDependencyEntry => ({
  kind: "adapter",
  identity: adapter.adapterId,
  projectRelativePath: null,
  contentHash: sha256(canonicalJson(adapter)),
});

const kindFor = (extension: string): HyperframesDependencyEntry["kind"] => {
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".css") return "css";
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(extension)) return "font";
  if ([".glsl", ".vert", ".frag", ".wgsl"].includes(extension)) return "shader";
  if ([".json", ".csv", ".tsv", ".xml", ".vtt", ".srt"].includes(extension)) return "data";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extension)) return "script";
  return "media";
};

const textExtensions = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".glsl",
  ".vert",
  ".frag",
  ".wgsl",
]);

const isInside = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

const canonicalJson = (value: unknown): string => JSON.stringify(sortJson(value));

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
};

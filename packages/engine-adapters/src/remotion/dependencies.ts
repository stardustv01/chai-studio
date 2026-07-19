import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  RemotionDependencyEntry,
  RemotionDependencySet,
  RemotionSourceDescriptor,
} from "./contracts.js";
import { pinnedRemotionVersion } from "./contracts.js";

export const collectRemotionDependencies = async (
  source: RemotionSourceDescriptor,
  compositionId: string,
): Promise<RemotionDependencySet> => {
  const projectRoot = await realpath(source.projectRoot);
  const sourceModules = await collectSourceModules([source.entryPoint, source.componentPath], projectRoot);
  const entries: RemotionDependencyEntry[] = [];
  for (const sourcePath of sourceModules)
    entries.push(await fileEntry("source-module", sourcePath, projectRoot));
  for (const assetPath of source.assetPaths) {
    entries.push(await fileEntry("media", resolveProjectPath(assetPath, projectRoot), projectRoot));
  }
  for (const fontPath of source.fontPaths) {
    entries.push(await fileEntry("font", resolveProjectPath(fontPath, projectRoot), projectRoot));
  }
  for (const generatedPath of source.generatedCodePaths) {
    entries.push(
      await fileEntry("generated-code", resolveProjectPath(generatedPath, projectRoot), projectRoot),
    );
  }
  entries.push({
    kind: "input-props",
    identity: `${source.sourceId}:${compositionId}:input-props`,
    projectRelativePath: null,
    contentHash: sha256(canonicalJson(source.inputProps)),
  });
  for (const packageName of ["remotion", "@remotion/renderer", "@remotion/bundler", "@remotion/player"]) {
    entries.push({
      kind: "runtime-package",
      identity: packageName,
      projectRelativePath: null,
      contentHash: sha256(`${packageName}@${pinnedRemotionVersion}`),
    });
  }
  for (const resource of [...source.approvedNetworkResources].sort((left, right) =>
    left.url.localeCompare(right.url),
  )) {
    assertSha256(resource.contentHash, resource.url);
    entries.push({
      kind: "approved-network",
      identity: resource.url,
      projectRelativePath: null,
      contentHash: resource.contentHash,
    });
  }
  const sorted = [...deduplicate(entries)].sort((left, right) =>
    `${left.kind}:${left.identity}`.localeCompare(`${right.kind}:${right.identity}`),
  );
  return {
    schemaVersion: "1.0.0",
    sourceId: source.sourceId,
    compositionId,
    entries: sorted,
    dependencyGraphHash: sha256(canonicalJson(sorted)),
  };
};

const collectSourceModules = async (
  entryPoints: readonly string[],
  projectRoot: string,
): Promise<readonly string[]> => {
  const visited = new Set<string>();
  const visit = async (candidate: string): Promise<void> => {
    const resolved = await realpath(candidate);
    assertInside(resolved, projectRoot);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const source = await readFile(resolved, "utf8");
    const imports = [
      ...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g),
    ]
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier?.startsWith(".") === true);
    for (const specifier of imports) {
      const dependency = await resolveModulePath(path.resolve(path.dirname(resolved), specifier));
      if (dependency !== null) await visit(dependency);
    }
  };
  for (const entryPoint of entryPoints) await visit(entryPoint);
  return [...visited].sort();
};

const resolveModulePath = async (base: string): Promise<string | null> => {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through deterministic local module candidates.
    }
  }
  return null;
};

const fileEntry = async (
  kind: Extract<RemotionDependencyEntry["kind"], "source-module" | "media" | "font" | "generated-code">,
  absolutePath: string,
  projectRoot: string,
): Promise<RemotionDependencyEntry> => {
  const resolved = await realpath(absolutePath);
  assertInside(resolved, projectRoot);
  const relative = path.relative(projectRoot, resolved).split(path.sep).join("/");
  return {
    kind,
    identity: relative,
    projectRelativePath: relative,
    contentHash: sha256(await readFile(resolved)),
  };
};

const resolveProjectPath = (candidate: string, projectRoot: string): string =>
  path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);

const assertInside = (candidate: string, projectRoot: string): void => {
  if (candidate !== projectRoot && !candidate.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Remotion dependency escapes the project root: ${candidate}`);
  }
};

const assertSha256 = (value: string, identity: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Remotion dependency ${identity} lacks a SHA-256 hash.`);
};

const deduplicate = (entries: readonly RemotionDependencyEntry[]): readonly RemotionDependencyEntry[] => {
  const byIdentity = new Map<string, RemotionDependencyEntry>();
  for (const entry of entries) byIdentity.set(`${entry.kind}:${entry.identity}`, entry);
  return [...byIdentity.values()];
};

const canonicalJson = (value: unknown): string => JSON.stringify(sortJson(value));

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
};

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

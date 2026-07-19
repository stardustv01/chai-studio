import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ExecutableSecurityPolicy, SecurityPathAccess, SecurityRootPolicy } from "./contracts.js";

export interface AuthorizedSecurityPath {
  readonly canonicalPath: string;
  readonly rootId: string;
  readonly rootMode: SecurityRootPolicy["mode"];
  readonly projectRelativePath: string;
  readonly access: SecurityPathAccess;
}

export const authorizeSecurityPath = async (input: {
  readonly candidatePath: string;
  readonly access: SecurityPathAccess;
  readonly policy: ExecutableSecurityPolicy;
  readonly mustExist?: boolean;
}): Promise<AuthorizedSecurityPath> => {
  rejectTraversalSyntax(input.candidatePath);
  const lexical = path.resolve(input.candidatePath);
  const mustExist = input.mustExist ?? input.access === "read";
  const canonical = mustExist ? await canonicalExisting(lexical) : await canonicalProspective(lexical);
  const roots = await Promise.all(
    input.policy.rootPolicies.map(async (root) => ({ root, canonical: await canonicalExisting(root.path) })),
  );
  const selected = roots.find(
    ({ root, canonical: rootPath }) => isContained(rootPath, canonical) && permits(root.mode, input.access),
  );
  if (selected === undefined)
    throw new Error("Path is outside an approved root or its access mode is forbidden.");
  if (input.access === "read" && !(await stat(canonical)).isFile()) {
    throw new Error("Approved read path must identify a regular file.");
  }
  return {
    canonicalPath: canonical,
    rootId: selected.root.id,
    rootMode: selected.root.mode,
    projectRelativePath: toPosix(path.relative(selected.canonical, canonical)) || ".",
    access: input.access,
  };
};

export const isContained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

const canonicalExisting = async (candidate: string): Promise<string> => {
  const canonical = await realpath(candidate).catch(() => {
    throw new Error("Approved path does not exist or cannot be resolved canonically.");
  });
  return path.resolve(canonical);
};

const canonicalProspective = async (candidate: string): Promise<string> => {
  try {
    return path.resolve(await realpath(candidate));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let cursor = candidate;
  const suffix: string[] = [];
  for (;;) {
    try {
      await lstat(cursor);
      const parent = await realpath(cursor);
      if (!(await stat(parent)).isDirectory()) {
        throw new Error("Prospective output parent is not a directory.");
      }
      return path.join(parent, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (cursor === path.dirname(cursor)) throw error;
      suffix.push(path.basename(cursor));
      cursor = path.dirname(cursor);
    }
  }
};

const permits = (mode: SecurityRootPolicy["mode"], access: SecurityPathAccess): boolean =>
  access === "read"
    ? true
    : access === "temporary"
      ? mode === "temporary" || mode === "read-write"
      : access === "output"
        ? mode === "output-only" || mode === "read-write"
        : mode === "read-write";

const rejectTraversalSyntax = (candidate: string): void => {
  if (candidate.includes("\0") || candidate.split(/[\\/]+/).includes("..")) {
    throw new Error("Path traversal syntax is forbidden before canonical resolution.");
  }
};

const toPosix = (value: string): string => value.split(path.sep).join("/");

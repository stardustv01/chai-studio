import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { normalizeAssetRegistryPath } from "./asset-registry.js";

export interface ApprovedExternalAssetRoot {
  readonly id: string;
  readonly path: string;
}

export interface AuthorizeAssetPathInput {
  readonly projectRoot: string;
  readonly candidatePath: string;
  readonly approvedExternalRoots?: readonly ApprovedExternalAssetRoot[];
}

export interface AuthorizedAssetPath {
  readonly canonicalPath: string;
  readonly registryPath: string;
  readonly scope: "project" | "approved-external";
  readonly externalRootId: string | null;
}

export const authorizeAssetPath = async (input: AuthorizeAssetPathInput): Promise<AuthorizedAssetPath> => {
  const projectRoot = await canonicalDirectory(input.projectRoot, "media.path.project-root-invalid");
  rejectTraversalSyntax(input.candidatePath);
  const candidateLexical = path.isAbsolute(input.candidatePath)
    ? path.resolve(input.candidatePath)
    : path.resolve(projectRoot, input.candidatePath);
  const externalRoots = await Promise.all(
    (input.approvedExternalRoots ?? []).map(async (root) => ({
      id: assertExternalRootId(root.id),
      canonicalPath: await canonicalDirectory(root.path, "media.path.external-root-invalid"),
    })),
  );

  const canonicalPath = await realpath(candidateLexical).catch((error: unknown) => {
    throw pathError(
      "media.path.missing",
      `Asset path does not exist or cannot be resolved: ${input.candidatePath}.`,
      "Restore the file, relink it, or register a different existing source.",
      error,
    );
  });
  const info = await stat(canonicalPath);
  if (!info.isFile()) {
    throw pathError(
      "media.path.not-file",
      `Authorized asset path is not a regular file: ${input.candidatePath}.`,
      "Select a regular file rather than a directory or special device.",
    );
  }
  if (isContainedPath(projectRoot, canonicalPath)) {
    return {
      canonicalPath,
      registryPath: normalizeAssetRegistryPath(toPosix(path.relative(projectRoot, canonicalPath))),
      scope: "project",
      externalRootId: null,
    };
  }
  const external = externalRoots.find((root) => isContainedPath(root.canonicalPath, canonicalPath));
  if (external === undefined) {
    const looksProjectLocal =
      !path.isAbsolute(input.candidatePath) ||
      isContainedPath(path.resolve(input.projectRoot), candidateLexical);
    throw pathError(
      looksProjectLocal ? "media.path.symlink-escape" : "media.path.root-not-approved",
      looksProjectLocal
        ? `Asset resolves outside approved roots: ${input.candidatePath}.`
        : `Asset path is outside the project and approved external roots: ${input.candidatePath}.`,
      looksProjectLocal
        ? "Remove the escaping symlink or approve the canonical external root explicitly."
        : "Move the file into the project or explicitly approve its external root.",
    );
  }
  return {
    canonicalPath,
    registryPath: normalizeAssetRegistryPath(
      `external/${external.id}/${toPosix(path.relative(external.canonicalPath, canonicalPath))}`,
    ),
    scope: "approved-external",
    externalRootId: external.id,
  };
};

export const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

const canonicalDirectory = async (directory: string, code: string): Promise<string> => {
  const canonical = await realpath(directory).catch((error: unknown) => {
    throw pathError(
      code,
      `Approved root cannot be resolved: ${directory}.`,
      "Choose an existing directory.",
      error,
    );
  });
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw pathError(code, `Approved root is not a directory: ${directory}.`, "Choose an existing directory.");
  }
  return canonical;
};

const rejectTraversalSyntax = (candidate: string): void => {
  const portable = candidate.replaceAll("\\", "/");
  if (portable.split("/").some((segment) => segment === "..")) {
    throw pathError(
      "media.path.traversal",
      `Asset path contains traversal syntax: ${candidate}.`,
      "Provide a direct project-relative path or an absolute path inside an approved root.",
    );
  }
};

const assertExternalRootId = (id: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,63}$/.test(id)) {
    throw pathError(
      "media.path.external-root-id-invalid",
      `Invalid approved external root ID: ${id}.`,
      "Use a stable contract-safe root alias.",
    );
  }
  return id;
};

const toPosix = (value: string): string => value.split(path.sep).join("/").normalize("NFC");

const pathError = (code: string, message: string, repairHint: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "asset-path-policy",
    message,
    repairHint,
    ...(cause === undefined ? {} : { cause }),
  });

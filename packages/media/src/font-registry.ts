import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { AssetRecord } from "@chai-studio/schema";
import { sha256File } from "./asset-registry.js";
import { authorizeAssetPath, type ApprovedExternalAssetRoot } from "./path-policy.js";

export interface FontIdentity {
  readonly family: string;
  readonly style: string;
  readonly postScriptName: string;
}

export interface ProjectFontRecord extends FontIdentity {
  readonly id: string;
  readonly registryPath: string;
  readonly contentHash: string;
  readonly bundlePolicy: "project-bundled" | "approved-external";
  readonly rights: AssetRecord["rights"];
}

export interface ProjectFontManifestV1 {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly revisionId: string;
  readonly fonts: readonly ProjectFontRecord[];
}

export interface PrepareFontRegistrationInput {
  readonly id: string;
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly approvedExternalRoots?: readonly ApprovedExternalAssetRoot[];
  readonly requireProjectBundle: boolean;
  readonly rights: AssetRecord["rights"];
}

export interface ResolvedProjectFont extends ProjectFontRecord {
  readonly canonicalPath: string;
}

export interface FontResolutionIssue {
  readonly code: "font.missing" | "font.hash-mismatch" | "font.identity-conflict";
  readonly fontId: string;
  readonly message: string;
  readonly repairHint: string;
}

export interface FontResolutionReport {
  readonly passed: boolean;
  readonly resolved: readonly ResolvedProjectFont[];
  readonly issues: readonly FontResolutionIssue[];
  readonly environmentFingerprint: string | null;
}

export const prepareFontRegistration = async (
  input: PrepareFontRegistrationInput,
): Promise<ProjectFontRecord> => {
  assertFontId(input.id);
  const authorized = await authorizeAssetPath({
    projectRoot: input.projectRoot,
    candidatePath: input.sourcePath,
    ...(input.approvedExternalRoots === undefined
      ? {}
      : { approvedExternalRoots: input.approvedExternalRoots }),
  });
  if (input.requireProjectBundle && authorized.scope !== "project") {
    throw fontError(
      "media.font.bundle-required",
      `Font ${input.id} must be copied into the project bundle before registration.`,
    );
  }
  if (!/\.(?:otf|ttf)$/i.test(authorized.canonicalPath)) {
    throw fontError("media.font.format-unsupported", "Only local OpenType OTF and TTF fonts are supported.");
  }
  const identity = parseOpenTypeFontIdentity(await readFile(authorized.canonicalPath));
  return {
    id: input.id,
    registryPath: authorized.registryPath,
    contentHash: await sha256File(authorized.canonicalPath),
    bundlePolicy: authorized.scope === "project" ? "project-bundled" : "approved-external",
    rights: input.rights,
    ...identity,
  };
};

export const createProjectFontManifest = (input: {
  readonly projectId: string;
  readonly revisionId: string;
  readonly fonts: readonly ProjectFontRecord[];
}): ProjectFontManifestV1 => {
  const fonts = [...input.fonts].sort((left, right) => left.id.localeCompare(right.id, "en"));
  const ids = new Set<string>();
  const postScriptNames = new Set<string>();
  for (const font of fonts) {
    assertFontRecord(font);
    if (ids.has(font.id)) throw fontError("media.font.id-duplicate", `Font ID is duplicated: ${font.id}.`);
    if (postScriptNames.has(font.postScriptName)) {
      throw fontError(
        "media.font.postscript-duplicate",
        `PostScript name is duplicated: ${font.postScriptName}.`,
      );
    }
    ids.add(font.id);
    postScriptNames.add(font.postScriptName);
  }
  return { schemaVersion: "1.0.0", projectId: input.projectId, revisionId: input.revisionId, fonts };
};

export const serializeProjectFontManifest = (manifest: ProjectFontManifestV1): string =>
  `${JSON.stringify(createProjectFontManifest(manifest), null, 2)}\n`;

export const fontRecordToAssetRecord = (font: ProjectFontRecord): AssetRecord => {
  assertFontRecord(font);
  return {
    id: font.id,
    path: font.registryPath,
    contentHash: font.contentHash,
    kind: "data",
    durationFrames: null,
    fps: null,
    hasAudio: false,
    hasAlpha: false,
    variableFrameRate: false,
    rights: font.rights,
    validationState: "valid",
  };
};

export const fontManifestToAssetRecord = (
  manifest: ProjectFontManifestV1,
  id: string,
  registryPath = "assets/fonts/font-manifest.json",
): AssetRecord => {
  assertFontId(id);
  return {
    id,
    path: registryPath,
    contentHash: createHash("sha256").update(serializeProjectFontManifest(manifest)).digest("hex"),
    kind: "data",
    durationFrames: null,
    fps: null,
    hasAudio: false,
    hasAlpha: false,
    variableFrameRate: false,
    rights: "owned",
    validationState: "valid",
  };
};

export const resolveProjectFonts = async (
  manifest: ProjectFontManifestV1,
  resolvePath: (font: ProjectFontRecord) => Promise<string>,
): Promise<FontResolutionReport> => {
  const validated = createProjectFontManifest(manifest);
  const resolved: ResolvedProjectFont[] = [];
  const issues: FontResolutionIssue[] = [];
  for (const font of validated.fonts) {
    let canonicalPath: string;
    try {
      canonicalPath = await resolvePath(font);
    } catch {
      issues.push({
        code: "font.missing",
        fontId: font.id,
        message: `Font file is missing: ${font.registryPath}.`,
        repairHint: "Restore or relink the exact hashed font file.",
      });
      continue;
    }
    const actualHash = await sha256File(canonicalPath).catch(() => null);
    if (actualHash === null) {
      issues.push({
        code: "font.missing",
        fontId: font.id,
        message: `Font file cannot be read: ${font.registryPath}.`,
        repairHint: "Restore readable local font bytes.",
      });
      continue;
    }
    if (actualHash !== font.contentHash) {
      issues.push({
        code: "font.hash-mismatch",
        fontId: font.id,
        message: `Font content changed for ${font.postScriptName}.`,
        repairHint: "Restore the registered font or explicitly replace it and invalidate dependent renders.",
      });
      continue;
    }
    resolved.push({ ...font, canonicalPath });
  }
  const passed = issues.length === 0;
  return {
    passed,
    resolved,
    issues,
    environmentFingerprint: passed ? fingerprintResolvedFonts(resolved) : null,
  };
};

export const assertProjectFontsResolved = (report: FontResolutionReport): readonly ResolvedProjectFont[] => {
  if (!report.passed) {
    throw fontError(
      "media.font.resolution-failed",
      report.issues.map((issue) => `${issue.fontId}: ${issue.message}`).join("; "),
    );
  }
  return report.resolved;
};

export const fingerprintResolvedFonts = (fonts: readonly ResolvedProjectFont[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...fonts]
          .sort((left, right) => left.id.localeCompare(right.id, "en"))
          .map((font) => ({
            id: font.id,
            postScriptName: font.postScriptName,
            contentHash: font.contentHash,
          })),
      ),
    )
    .digest("hex");

export const parseOpenTypeFontIdentity = (bytes: Buffer): FontIdentity => {
  const sfntOffset = bytes.subarray(0, 4).toString("ascii") === "ttcf" ? readU32(bytes, 12) : 0;
  const tableCount = readU16(bytes, sfntOffset + 4);
  let nameOffset: number | null = null;
  for (let index = 0; index < tableCount; index += 1) {
    const entryOffset = sfntOffset + 12 + index * 16;
    if (bytes.subarray(entryOffset, entryOffset + 4).toString("ascii") === "name") {
      nameOffset = readU32(bytes, entryOffset + 8);
      break;
    }
  }
  if (nameOffset === null)
    throw fontError("media.font.name-table-missing", "OpenType font has no name table.");
  const count = readU16(bytes, nameOffset + 2);
  const stringsOffset = nameOffset + readU16(bytes, nameOffset + 4);
  const names = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const recordOffset = nameOffset + 6 + index * 12;
    const platformId = readU16(bytes, recordOffset);
    const nameId = readU16(bytes, recordOffset + 6);
    const length = readU16(bytes, recordOffset + 8);
    const offset = readU16(bytes, recordOffset + 10);
    const raw = bytes.subarray(stringsOffset + offset, stringsOffset + offset + length);
    const decoded = decodeFontName(raw, platformId).trim();
    if (decoded.length > 0 && !names.has(nameId)) names.set(nameId, decoded);
  }
  const family = names.get(16) ?? names.get(1);
  const style = names.get(17) ?? names.get(2) ?? "Regular";
  const postScriptName = names.get(6);
  if (family === undefined || postScriptName === undefined) {
    throw fontError("media.font.identity-missing", "Font family or PostScript name is missing.");
  }
  return { family, style, postScriptName };
};

const decodeFontName = (bytes: Buffer, platformId: number): string => {
  if (platformId !== 0 && platformId !== 3) return bytes.toString("latin1").replaceAll("\u0000", "");
  let result = "";
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    result += String.fromCharCode(bytes.readUInt16BE(offset));
  }
  return result;
};

const readU16 = (bytes: Buffer, offset: number): number => {
  if (offset < 0 || offset + 2 > bytes.length) throw fontError("media.font.truncated", "Font is truncated.");
  return bytes.readUInt16BE(offset);
};

const readU32 = (bytes: Buffer, offset: number): number => {
  if (offset < 0 || offset + 4 > bytes.length) throw fontError("media.font.truncated", "Font is truncated.");
  return bytes.readUInt32BE(offset);
};

const assertFontRecord = (font: ProjectFontRecord): void => {
  assertFontId(font.id);
  if (
    font.family.trim().length === 0 ||
    font.style.trim().length === 0 ||
    font.postScriptName.trim().length === 0 ||
    !/^[a-f0-9]{64}$/.test(font.contentHash)
  ) {
    throw fontError("media.font.record-invalid", `Font record is invalid: ${font.id}.`);
  }
};

const assertFontId = (id: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(id)) {
    throw fontError("media.font.id-invalid", `Invalid stable font ID: ${id}.`);
  }
};

const fontError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "font-registry",
    message,
    repairHint: "Bundle or approve the exact font bytes and resolve them by manifest hash.",
  });

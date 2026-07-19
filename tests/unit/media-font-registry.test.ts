import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProjectFontsResolved,
  createProjectFontManifest,
  fontManifestToAssetRecord,
  fontRecordToAssetRecord,
  parseOpenTypeFontIdentity,
  prepareFontRegistration,
  resolveProjectFonts,
  serializeProjectFontManifest,
} from "../../packages/media/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project font registration and resolution", () => {
  it("parses OpenType identity and creates deterministic hashed manifest assets", async () => {
    const fixture = await fontFixture();
    expect(parseOpenTypeFontIdentity(openTypeFixture())).toEqual({
      family: "Chai Sans",
      style: "Bold",
      postScriptName: "ChaiSans-Bold",
    });
    const font = await prepareFontRegistration({
      id: "font-chai-sans-bold",
      projectRoot: fixture.projectRoot,
      sourcePath: "assets/fonts/ChaiSans-Bold.ttf",
      requireProjectBundle: true,
      rights: "licensed",
    });
    expect(font).toMatchObject({
      registryPath: "assets/fonts/ChaiSans-Bold.ttf",
      family: "Chai Sans",
      style: "Bold",
      postScriptName: "ChaiSans-Bold",
      bundlePolicy: "project-bundled",
    });
    const manifest = createProjectFontManifest({
      projectId: "project-font-0001",
      revisionId: "revision-font-0001",
      fonts: [font],
    });
    expect(serializeProjectFontManifest(manifest)).toContain('"postScriptName": "ChaiSans-Bold"');
    expect(fontRecordToAssetRecord(font)).toMatchObject({
      id: font.id,
      kind: "data",
      contentHash: font.contentHash,
    });
    expect(fontManifestToAssetRecord(manifest, "asset-font-manifest-0001")).toMatchObject({
      path: "assets/fonts/font-manifest.json",
      kind: "data",
      validationState: "valid",
    });
  });

  it("resolves identical bytes for every consumer and reports hash drift or missing fonts", async () => {
    const fixture = await fontFixture();
    const font = await prepareFontRegistration({
      id: "font-chai-sans-bold",
      projectRoot: fixture.projectRoot,
      sourcePath: "assets/fonts/ChaiSans-Bold.ttf",
      requireProjectBundle: true,
      rights: "licensed",
    });
    const manifest = createProjectFontManifest({
      projectId: "project-font-0001",
      revisionId: "revision-font-0001",
      fonts: [font],
    });
    const resolved = await resolveProjectFonts(manifest, () => Promise.resolve(fixture.fontPath));
    expect(resolved.passed).toBe(true);
    expect(resolved.environmentFingerprint).toHaveLength(64);
    expect(assertProjectFontsResolved(resolved)[0]?.canonicalPath).toBe(fixture.fontPath);

    await writeFile(fixture.fontPath, "changed-font");
    const changed = await resolveProjectFonts(manifest, () => Promise.resolve(fixture.fontPath));
    expect(changed.issues[0]?.code).toBe("font.hash-mismatch");
    const missing = await resolveProjectFonts(manifest, () => Promise.reject(new Error("missing")));
    expect(missing.issues[0]?.code).toBe("font.missing");
  });

  it("enforces project-bundle policy and rejects corrupt font tables", async () => {
    const fixture = await fontFixture();
    const externalRoot = path.join(fixture.root, "external");
    await mkdir(externalRoot, { recursive: true });
    const externalFont = path.join(externalRoot, "External.ttf");
    await writeFile(externalFont, openTypeFixture());
    await expect(
      prepareFontRegistration({
        id: "font-external-0001",
        projectRoot: fixture.projectRoot,
        sourcePath: externalFont,
        approvedExternalRoots: [{ id: "external-fonts", path: externalRoot }],
        requireProjectBundle: true,
        rights: "licensed",
      }),
    ).rejects.toThrow(/must be copied into the project bundle/);
    expect(() => parseOpenTypeFontIdentity(Buffer.alloc(8))).toThrow(/truncated|name table/);
  });
});

const fontFixture = async (): Promise<{
  readonly root: string;
  readonly projectRoot: string;
  readonly fontPath: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-font-registry-"));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, "project");
  const fontsDirectory = path.join(projectRoot, "assets", "fonts");
  await mkdir(fontsDirectory, { recursive: true });
  const fontPath = path.join(fontsDirectory, "ChaiSans-Bold.ttf");
  await writeFile(fontPath, openTypeFixture());
  return { root, projectRoot, fontPath };
};

const openTypeFixture = (): Buffer => {
  const strings = [utf16be("Chai Sans"), utf16be("Bold"), utf16be("ChaiSans-Bold")];
  const nameTableOffset = 28;
  const stringOffset = 6 + strings.length * 12;
  const totalLength =
    nameTableOffset + stringOffset + strings.reduce((total, value) => total + value.length, 0);
  const bytes = Buffer.alloc(totalLength);
  bytes.writeUInt32BE(0x0001_0000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write("name", 12, "ascii");
  bytes.writeUInt32BE(nameTableOffset, 20);
  bytes.writeUInt32BE(totalLength - nameTableOffset, 24);
  bytes.writeUInt16BE(0, nameTableOffset);
  bytes.writeUInt16BE(strings.length, nameTableOffset + 2);
  bytes.writeUInt16BE(stringOffset, nameTableOffset + 4);
  const nameIds = [1, 2, 6];
  let accumulated = 0;
  strings.forEach((value, index) => {
    const record = nameTableOffset + 6 + index * 12;
    bytes.writeUInt16BE(3, record);
    bytes.writeUInt16BE(1, record + 2);
    bytes.writeUInt16BE(0x0409, record + 4);
    bytes.writeUInt16BE(nameIds[index] ?? 1, record + 6);
    bytes.writeUInt16BE(value.length, record + 8);
    bytes.writeUInt16BE(accumulated, record + 10);
    value.copy(bytes, nameTableOffset + stringOffset + accumulated);
    accumulated += value.length;
  });
  return bytes;
};

const utf16be = (value: string): Buffer => {
  const bytes = Buffer.alloc(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    bytes.writeUInt16BE(value.charCodeAt(index), index * 2);
  }
  return bytes;
};

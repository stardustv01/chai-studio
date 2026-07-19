import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProjectDocument,
  canonicalProjectDirectories,
  hashRevisionDocuments,
  initializeProjectFolder,
  revisionDocumentNames,
  stringifyCanonicalJson,
  validateProjectSnapshot,
  type ProjectRevisionSnapshot,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("self-contained project folder initialization", () => {
  it("creates a complete immediately valid project with no database-only authority", async () => {
    const parent = await temporaryParent();
    const target = path.join(parent, "first-light.chai");
    const initialized = await initializeProjectFolder(target, {
      title: "First Light",
      projectId: "project-initializer-0001",
      revisionId: "revision-initializer-0001",
      actorId: "actor-user-0001",
      sessionId: "session-test-0001",
      now: new Date("2026-07-15T00:00:00Z"),
    });

    for (const directory of canonicalProjectDirectories)
      expect((await stat(path.join(target, directory))).isDirectory()).toBe(true);
    const revisionDirectory = path.join(target, "revisions", initialized.revisionId);
    expect((await readdir(revisionDirectory)).sort()).toEqual([...revisionDocumentNames].sort());

    const documents = Object.fromEntries(
      await Promise.all(
        revisionDocumentNames.map(
          async (name) =>
            [
              name,
              JSON.parse(await readFile(path.join(revisionDirectory, name), "utf8")) as unknown,
            ] as const,
        ),
      ),
    ) as Record<string, unknown>;
    const pointer = assertProjectDocument(
      "current-revision",
      JSON.parse(await readFile(path.join(target, "current-revision.json"), "utf8")) as unknown,
    );
    expect(pointer.revisionHash).toBe(hashRevisionDocuments(documents));
    expect(pointer).toEqual(initialized.pointer);

    const snapshot: ProjectRevisionSnapshot = {
      project: assertProjectDocument("chai.project", documents["chai.project.json"]),
      timeline: assertProjectDocument("timeline", documents["timeline.json"]),
      assets: assertProjectDocument("assets", documents["assets.json"]),
      settings: assertProjectDocument("settings", documents["settings.json"]),
      approvalState: assertProjectDocument("approval-state", documents["approval-state.json"]),
      transaction: assertProjectDocument("transaction", documents["transaction.json"]),
    };
    expect(validateProjectSnapshot(snapshot)).toEqual({ passed: true, issues: [] });
    expect(
      assertProjectDocument(
        "autosave-metadata",
        JSON.parse(await readFile(path.join(target, "autosave-metadata.json"), "utf8")) as unknown,
      ).cleanShutdown,
    ).toBe(true);
    expect(
      assertProjectDocument(
        "named-versions",
        JSON.parse(await readFile(path.join(target, "named-versions.json"), "utf8")) as unknown,
      ).versions[0]?.name,
    ).toBe("Draft");
    expect((await allFiles(target)).some((file) => /\.(?:db|sqlite|sqlite3)$/i.test(file))).toBe(false);
  });

  it("refuses existing targets and removes failed staging state", async () => {
    const parent = await temporaryParent();
    const existing = path.join(parent, "existing.chai");
    await mkdir(existing);
    await expect(initializeProjectFolder(existing, { title: "No overwrite" })).rejects.toThrow(
      /already exists/,
    );

    const invalid = path.join(parent, "invalid.chai");
    await expect(
      initializeProjectFolder(invalid, {
        title: "",
        projectId: "project-invalid-0001",
        revisionId: "revision-invalid-0001",
      }),
    ).rejects.toThrow(/structural validation/);
    expect(await readdir(parent)).toEqual(["existing.chai"]);
  });

  it("canonicalizes object keys and rejects values JSON cannot preserve", () => {
    expect(stringifyCanonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
    expect(() => stringifyCanonicalJson({ value: 1n })).toThrow(/Unsupported canonical JSON value type/);
    expect(() => stringifyCanonicalJson({ value: undefined })).toThrow(/Undefined is not valid JSON/);
  });
});

const temporaryParent = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "chai-project-initializer-"));
  temporaryRoots.push(directory);
  return directory;
};

const allFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await allFiles(target)));
    else files.push(target);
  }
  return files;
};

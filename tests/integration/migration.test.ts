import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateProjectArtifactFile,
  migrateProjectDocumentBundle,
  projectDocumentKinds,
  rollbackProjectArtifactMigration,
  sha256CanonicalJson,
  stringifyCanonicalJson,
  validateProjectDocument,
} from "../../packages/schema/src/index.js";

const currentFixture = JSON.parse(
  await readFile(
    new URL("../../fixtures/deterministic/project-model/valid-documents.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("versioned project migration registry", () => {
  it("migrates an old fixture deterministically without reinterpreting rational timing", () => {
    const legacy = legacyFixture();
    const first = migrateProjectDocumentBundle(legacy, { dryRun: true });
    const second = migrateProjectDocumentBundle(structuredClone(legacy), { dryRun: true });
    expect(first.report).toMatchObject({
      migrationId: "project-bundle-0.9.0-to-1.0.0",
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      dryRun: true,
      migrated: true,
      backupPath: null,
    });
    expect(first.report.targetHash).toBe(second.report.targetHash);
    expect(first.documents).toEqual(second.documents);
    expect(first.report.changedPaths).toEqual(
      expect.arrayContaining([
        "/chai.project/sources",
        "/transaction/history",
        "/transaction/commandEnvelopeHash",
      ]),
    );
    for (const kind of projectDocumentKinds) {
      expect(validateProjectDocument(kind, first.documents[kind]).ok, kind).toBe(true);
    }
    expect((first.documents["chai.project"] as { video: { fps: unknown } }).video.fps).toEqual({
      numerator: "30000",
      denominator: "1001",
    });
  });

  it("creates a byte-independent canonical backup and rolls back only an unchanged migration", async () => {
    const parent = await temporaryParent();
    const filePath = path.join(parent, "legacy-project-bundle.json");
    const legacy = legacyFixture();
    await writeFile(filePath, stringifyCanonicalJson(legacy), "utf8");
    const sourceHash = sha256CanonicalJson(legacy);

    const dryRun = await migrateProjectArtifactFile(filePath, { dryRun: true });
    expect(dryRun.backupPath).toBeNull();
    expect(sha256CanonicalJson(JSON.parse(await readFile(filePath, "utf8")) as unknown)).toBe(sourceHash);

    const report = await migrateProjectArtifactFile(filePath);
    expect(report.backupPath).toMatch(/\.backup-[a-f0-9]{16}\.json$/);
    expect(sha256CanonicalJson(JSON.parse(await readFile(filePath, "utf8")) as unknown)).toBe(
      report.targetHash,
    );
    if (report.backupPath === null) throw new Error("Migration did not create its required backup.");
    expect(sha256CanonicalJson(JSON.parse(await readFile(report.backupPath, "utf8")) as unknown)).toBe(
      sourceHash,
    );

    await rollbackProjectArtifactMigration(filePath, report);
    expect(sha256CanonicalJson(JSON.parse(await readFile(filePath, "utf8")) as unknown)).toBe(sourceHash);
  });

  it("fails newer versions and ambiguous numeric frame rates with explicit codes", () => {
    const newer = legacyFixture();
    for (const kind of projectDocumentKinds) {
      (newer[kind] as Record<string, unknown>).schemaVersion = "2.0.0";
    }
    expect(() => migrateProjectDocumentBundle(newer)).toThrow(
      expect.objectContaining({ code: "migration.version.newer-unsupported" }),
    );

    const ambiguous = legacyFixture();
    const project = ambiguous["chai.project"] as { video: { fps: unknown } };
    project.video.fps = 29.97;
    expect(() => migrateProjectDocumentBundle(ambiguous)).toThrow(
      expect.objectContaining({ code: "migration.timing.ambiguous" }),
    );
  });
});

const legacyFixture = (): Record<string, unknown> => {
  const legacy = structuredClone(currentFixture);
  for (const kind of projectDocumentKinds) {
    (legacy[kind] as Record<string, unknown>).schemaVersion = "0.9.0";
  }
  delete (legacy["chai.project"] as Record<string, unknown>).sources;
  const removedKeys = new Set([
    "idempotencyId",
    "correlationId",
    "commandEnvelopeHash",
    "capability",
    "declaredScope",
    "authorizationId",
    "validationOnly",
    "result",
    "history",
    "namedVersion",
  ]);
  legacy.transaction = Object.fromEntries(
    Object.entries(legacy.transaction as Record<string, unknown>).filter(([key]) => !removedKeys.has(key)),
  );
  return legacy;
};

const temporaryParent = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-migration-"));
  temporaryRoots.push(parent);
  return parent;
};

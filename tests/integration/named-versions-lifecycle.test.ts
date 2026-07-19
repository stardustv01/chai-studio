import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  rebuildNamedVersions,
  type LifecycleTransitionCommand,
  type VersionCreateCommand,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("named versions and QA lifecycle", () => {
  it("links approved milestones to the exact immutable output and rebuilds its index", async () => {
    const root = await initializedProject();
    await executeProjectCommand(root, transition("revision-version-0001", "rendered_unchecked", "0002"), {
      revisionId: "revision-version-0002",
      now: clock(2),
    });
    await executeProjectCommand(root, transition("revision-version-0002", "qa_passed", "0003"), {
      revisionId: "revision-version-0003",
      now: clock(3),
    });
    await executeProjectCommand(root, transition("revision-version-0003", "approved", "0004"), {
      revisionId: "revision-version-0004",
      now: clock(4),
    });
    const milestone = await executeProjectCommand(
      root,
      version("revision-version-0004", "Approved", "output-version-0001", "0005"),
      { revisionId: "revision-version-0005", now: clock(5) },
    );
    expect(milestone.status).toBe("committed");
    const current = await loadCurrentProjectRevision(root);
    expect(current.transaction.namedVersion).toEqual({
      id: "revision-version-0005:version",
      name: "Approved",
      revisionId: "revision-version-0005",
      createdAt: "2026-07-15T00:05:00.000Z",
      actorId: "actor-version-0001",
      outputId: "output-version-0001",
    });

    let index = JSON.parse(await readFile(path.join(root, "named-versions.json"), "utf8")) as {
      readonly versions: readonly { readonly name: string }[];
    };
    expect(index.versions.map((item) => item.name)).toEqual(["Draft", "Approved"]);
    await writeFile(path.join(root, "named-versions.json"), "{}\n", "utf8");
    index = await rebuildNamedVersions(root);
    expect(index.versions.map((item) => item.name)).toEqual(["Draft", "Approved"]);
  });

  it("refuses approval milestones before lifecycle evidence reaches approved", async () => {
    const root = await initializedProject();
    const failed = await executeProjectCommand(
      root,
      version("revision-version-0001", "Approved", "output-version-0001", "1002"),
      { revisionId: "revision-version-1002", now: clock(2) },
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "version.lifecycle.not-ready" },
    });
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-version-0001");
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-versions-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "versions.chai");
  await initializeProjectFolder(root, {
    title: "Version project",
    projectId: "project-version-0001",
    revisionId: "revision-version-0001",
    actorId: "actor-version-0001",
    sessionId: "session-version-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return root;
};

const common = {
  schemaVersion: "1.0.0",
  actor: { id: "actor-version-0001", kind: "user", sessionId: "session-version-0001" },
  projectId: "project-version-0001",
  issuedAt: "2026-07-15T00:00:30Z",
  capability: { name: "qa-lifecycle", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-version-0001"],
  declaredScope: "mutation",
  validationOnly: false,
  authorizationId: null,
} as const;

const transition = (
  baseRevisionId: string,
  to: LifecycleTransitionCommand["payload"]["to"],
  suffix: string,
): LifecycleTransitionCommand => ({
  ...common,
  commandId: `command-transition-${suffix}`,
  idempotencyId: `idempotency-transition-${suffix}`,
  correlationId: `correlation-transition-${suffix}`,
  baseRevisionId,
  kind: "lifecycle.transition",
  payload: {
    to,
    outputId: "output-version-0001",
    evidenceHashes: [suffix.padEnd(64, "a")],
    exceptionIds: [],
  },
});

const version = (
  baseRevisionId: string,
  name: VersionCreateCommand["payload"]["name"],
  outputId: string | null,
  suffix: string,
): VersionCreateCommand => ({
  ...common,
  commandId: `command-version-${suffix}`,
  idempotencyId: `idempotency-version-${suffix}`,
  correlationId: `correlation-version-${suffix}`,
  baseRevisionId,
  kind: "version.create",
  payload: { name, outputId },
});

const clock = (minute: number) => (): Date =>
  new Date(`2026-07-15T00:${String(minute).padStart(2, "0")}:00Z`);

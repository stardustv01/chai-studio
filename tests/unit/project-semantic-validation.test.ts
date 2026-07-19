import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertProjectDocument,
  validateProjectSnapshot,
  type ProjectRevisionSnapshot,
} from "../../packages/schema/src/index.js";

const fixture = JSON.parse(
  await readFile(
    new URL("../../fixtures/deterministic/project-model/valid-documents.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("whole-project semantic validation", () => {
  it("accepts the coordinated canonical project fixture", () => {
    expect(validateProjectSnapshot(snapshotFrom(fixture))).toEqual({ passed: true, issues: [] });
  });

  it.each([
    ["project.identity.mismatch", "/settings/projectId", "project-other-0001"],
    ["timeline.fps.mismatch", "/timeline/fps", { numerator: "24", denominator: "1" }],
    ["timeline.clip.asset-missing", "/timeline/tracks/0/clips/0/assetId", "asset-missing-0001"],
    ["timeline.clip.out-of-range", "/timeline/tracks/0/clips/0/durationFrames", "301"],
    ["timeline.clip.source-out-of-range", "/timeline/tracks/0/clips/0/sourceDurationFrames", "301"],
    ["audio.bus.missing", "/timeline/tracks/0/clips/0/audioBusId", "bus-missing-0001"],
    ["capability.unsupported", "/timeline/tracks/0/clips/0/capability", "unsupported"],
    ["approval.output.missing", "/approval-state/state", "approved"],
  ])("reports %s with entity-specific repair context", (code, pointer, value) => {
    const candidate = structuredClone(fixture);
    setJsonPointer(candidate, pointer, value);
    const validation = validateProjectSnapshot(snapshotFrom(candidate));
    expect(validation.passed).toBe(false);
    const found = validation.issues.find((issue) => issue.code === code);
    expect(found).toBeDefined();
    expect(found?.entityId.length).toBeGreaterThan(2);
    expect(found?.repairHint.length).toBeGreaterThan(10);
  });

  it("rejects half-open overlap while allowing adjacent clips", () => {
    const adjacent = structuredClone(fixture);
    setJsonPointer(adjacent, "/timeline/tracks/0/clips/0/durationFrames", "150");
    const adjacentClip = structuredClone(getArrayAt(adjacent, "/timeline/tracks/0/clips")[0]);
    setJsonPointer(adjacentClip, "/id", "clip-adjacent-0002");
    setJsonPointer(adjacentClip, "/startFrame", "150");
    setJsonPointer(adjacentClip, "/sourceInFrame", "150");
    setJsonPointer(adjacentClip, "/sourceDurationFrames", "150");
    getArrayAt(adjacent, "/timeline/tracks/0/clips").push(adjacentClip);
    expect(validateProjectSnapshot(snapshotFrom(adjacent)).passed).toBe(true);

    setJsonPointer(adjacent, "/timeline/tracks/0/clips/1/startFrame", "149");
    const overlap = validateProjectSnapshot(snapshotFrom(adjacent));
    expect(overlap.passed).toBe(false);
    expect(overlap.issues.some((issue) => issue.code === "timeline.clip.overlap")).toBe(true);
  });

  it("preserves experimental capability as an explicit non-blocking warning", () => {
    const candidate = structuredClone(fixture);
    setJsonPointer(candidate, "/timeline/tracks/0/clips/0/capability", "experimental");
    const validation = validateProjectSnapshot(snapshotFrom(candidate));
    expect(validation.passed).toBe(true);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "capability.experimental", severity: "warning" }),
      ]),
    );
  });
});

const snapshotFrom = (documents: Record<string, unknown>): ProjectRevisionSnapshot => ({
  project: assertProjectDocument("chai.project", documents["chai.project"]),
  timeline: assertProjectDocument("timeline", documents.timeline),
  assets: assertProjectDocument("assets", documents.assets),
  settings: assertProjectDocument("settings", documents.settings),
  transaction: assertProjectDocument("transaction", documents.transaction),
  approvalState: assertProjectDocument("approval-state", documents["approval-state"]),
});

const getArrayAt = (root: unknown, pointer: string): unknown[] => {
  const value = getAt(root, pointer);
  if (!Array.isArray(value)) throw new Error(`Fixture pointer is not an array: ${pointer}`);
  return value;
};

const getAt = (root: unknown, pointer: string): unknown => {
  let current = root;
  for (const segment of pointer.split("/").slice(1)) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current !== null && typeof current === "object")
      current = (current as Record<string, unknown>)[segment];
    else throw new Error(`Cannot traverse fixture pointer ${pointer}`);
  }
  return current;
};

const setJsonPointer = (root: unknown, pointer: string, value: unknown): void => {
  const segments = pointer.split("/").slice(1);
  const parentPointer = `/${segments.slice(0, -1).join("/")}`;
  const parent = segments.length === 1 ? root : getAt(root, parentPointer);
  const finalSegment = segments.at(-1);
  if (finalSegment === undefined) throw new Error("Cannot replace the fixture root.");
  if (Array.isArray(parent)) parent[Number(finalSegment)] = value;
  else if (parent !== null && typeof parent === "object")
    (parent as Record<string, unknown>)[finalSegment] = value;
  else throw new Error(`Cannot assign fixture pointer ${pointer}`);
};

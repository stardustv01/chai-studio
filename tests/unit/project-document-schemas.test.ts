import { readFile } from "node:fs/promises";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  assertProjectDocument,
  getProjectDocumentJsonSchema,
  projectDocumentKinds,
  projectDocumentSchemaBundle,
  validateProjectDocument,
  type ProjectDocumentKind,
} from "../../packages/schema/src/index.js";

const validDocuments = JSON.parse(
  await readFile(
    new URL("../../fixtures/deterministic/project-model/valid-documents.json", import.meta.url),
    "utf8",
  ),
) as Record<ProjectDocumentKind, unknown>;
const invalidCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/deterministic/project-model/invalid-documents.json", import.meta.url),
    "utf8",
  ),
) as readonly { kind: ProjectDocumentKind; mutation: string; path: string; value: unknown }[];

const independentAjv = new Ajv2020({ allErrors: true, strict: true });
independentAjv.addFormat("date-time", true);
independentAjv.addFormat("hostname", true);
independentAjv.addSchema(projectDocumentSchemaBundle);
const independentValidators = Object.fromEntries(
  projectDocumentKinds.map((kind) => [kind, independentAjv.compile(getProjectDocumentJsonSchema(kind))]),
) as Record<ProjectDocumentKind, ValidateFunction>;

describe("authoritative project document schemas", () => {
  it("defines and validates all nine required document roots", () => {
    expect(Object.keys(projectDocumentSchemaBundle.$defs)).toEqual(
      expect.arrayContaining([
        "project",
        "timeline",
        "assets",
        "settings",
        "transaction",
        "currentRevisionPointer",
        "autosaveMetadata",
        "namedVersions",
        "approvalState",
      ]),
    );
    expect(Object.keys(validDocuments).sort()).toEqual([...projectDocumentKinds].sort());
    for (const kind of projectDocumentKinds) {
      expect(validateProjectDocument(kind, validDocuments[kind]), kind).toEqual({
        ok: true,
        value: validDocuments[kind],
      });
      expect(independentValidators[kind](validDocuments[kind]), kind).toBe(true);
      expect(assertProjectDocument(kind, validDocuments[kind])).toBe(validDocuments[kind]);
    }
  });

  it("keeps the runtime wrapper and independent JSON Schema evaluation in agreement", () => {
    for (const invalidCase of invalidCases) {
      const candidate = structuredClone(validDocuments[invalidCase.kind]);
      setJsonPointer(candidate, invalidCase.path, invalidCase.value);
      const runtime = validateProjectDocument(invalidCase.kind, candidate);
      const jsonSchema = independentValidators[invalidCase.kind](candidate);
      expect(runtime.ok, invalidCase.mutation).toBe(false);
      expect(jsonSchema, invalidCase.mutation).toBe(false);
      if (!runtime.ok) {
        expect(runtime.issues.length).toBeGreaterThan(0);
        expect(runtime.issues[0]?.path).not.toBe("");
      }
      expect(() => assertProjectDocument(invalidCase.kind, candidate), invalidCase.mutation).toThrow(
        /structural validation/,
      );
    }
  });
});

const setJsonPointer = (root: unknown, pointer: string, value: unknown): void => {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current !== null && typeof current === "object")
      current = (current as Record<string, unknown>)[segment];
    else throw new Error(`Cannot traverse fixture pointer ${pointer}`);
  }
  const finalSegment = segments.at(-1);
  if (finalSegment === undefined) throw new Error("Cannot replace the fixture root.");
  if (Array.isArray(current)) current[Number(finalSegment)] = value;
  else if (current !== null && typeof current === "object")
    (current as Record<string, unknown>)[finalSegment] = value;
  else throw new Error(`Cannot assign fixture pointer ${pointer}`);
};

import { describe, expect, it } from "vitest";
import {
  createStudioTimelineFixture,
  executeTimelineCommand,
  stableEntityId,
} from "../../packages/timeline/src/index.js";
import {
  fieldDraftValue,
  inspectorFields,
  inspectorImpact,
  parseInspectorDraft,
  resolveInspectorContext,
} from "../../apps/studio-web/src/inspector-contract.js";

describe("P15 contextual inspector contract", () => {
  it("resolves no selection, a single clip, multiple clips, tracks, markers, keyframes, and assets", () => {
    const timeline = createStudioTimelineFixture();
    expect(
      resolveInspectorContext({
        ...timeline,
        selection: { primaryId: null, selectedIds: [], anchorId: null },
      }).kind,
    ).toBe("none");
    expect(resolveInspectorContext(timeline)).toMatchObject({ kind: "clip", title: "FutureTitle_v04" });

    const clips = [
      stableEntityId("clip-studio-interview-a"),
      stableEntityId("clip-studio-product-macro"),
    ] as const;
    const selectedClips = executeTimelineCommand(timeline, {
      kind: "selection.set",
      entityIds: clips,
      mode: "replace",
      primaryId: clips[0],
    }).snapshot;
    expect(resolveInspectorContext(selectedClips)).toMatchObject({ kind: "clips", clipIds: clips });

    for (const [id, kind] of [
      [stableEntityId("track-studio-video-v1"), "track"],
      [stableEntityId("marker-studio-program-start"), "marker"],
      [stableEntityId("keyframe-studio-title-opacity-0001"), "keyframe"],
    ] as const) {
      const selection = { primaryId: id, selectedIds: [id], anchorId: id };
      expect(resolveInspectorContext({ ...timeline, selection }).kind).toBe(kind);
    }
    const empty = { ...timeline, selection: { primaryId: null, selectedIds: [], anchorId: null } };
    expect(resolveInspectorContext(empty, ["asset-title-001"])).toMatchObject({ kind: "asset" });
  });

  it("shows only safely shared common fields for multi-selection and exposes mixed values", () => {
    const timeline = createStudioTimelineFixture();
    const ids = [
      stableEntityId("clip-studio-interview-a"),
      stableEntityId("clip-studio-product-macro"),
    ] as const;
    const changed = executeTimelineCommand(timeline, {
      kind: "clips.properties.update",
      clipIds: [ids[0]],
      changes: { "transform.opacity": 42 },
    }).snapshot;
    const selected = executeTimelineCommand(changed, {
      kind: "selection.set",
      entityIds: ids,
      mode: "replace",
      primaryId: ids[0],
    }).snapshot;
    const fields = inspectorFields(selected, resolveInspectorContext(selected));
    const opacity = fields.find((field) => field.path === "transform.opacity");
    expect(opacity).toMatchObject({ mixed: true, clipIds: ids });
    expect(opacity === undefined ? null : fieldDraftValue(opacity)).toBe("");
    expect(fields.some((field) => field.path.startsWith("native."))).toBe(false);
  });

  it("rejects expressions and bounds violations while validating numbers, vectors, colors, enums, and text", () => {
    const timeline = createStudioTimelineFixture();
    const fields = inspectorFields(timeline, resolveInspectorContext(timeline));
    const field = (path: string) => {
      const value = fields.find((item) => item.path === path);
      if (value === undefined) throw new Error(`Missing ${path}`);
      return value;
    };
    expect(parseInspectorDraft(field("transform.opacity"), "50")).toEqual({ ok: true, value: 50 });
    expect(parseInspectorDraft(field("transform.opacity"), "25 + 25")).toMatchObject({ ok: false });
    expect(parseInspectorDraft(field("transform.opacity"), "101")).toMatchObject({ ok: false });
    expect(parseInspectorDraft(field("transform.position"), "12.5, -4")).toEqual({
      ok: true,
      value: [12.5, -4],
    });
    expect(parseInspectorDraft(field("native.remotion.accent"), "blue")).toMatchObject({ ok: false });
    expect(parseInspectorDraft(field("native.remotion.theme"), "Ember")).toEqual({
      ok: true,
      value: "Ember",
    });
    expect(parseInspectorDraft(field("native.remotion.headline"), "Exact words")).toEqual({
      ok: true,
      value: "Exact words",
    });
  });

  it("reports native descriptor evidence, cache state, dependencies, and exact affected render range", () => {
    const timeline = createStudioTimelineFixture();
    expect(inspectorImpact(timeline, resolveInspectorContext(timeline))).toEqual({
      validation: "valid",
      dependencySummary: "3 assets · 2 fonts · 1 React module",
      cacheSummary: "valid",
      affectedRange: "430–760 · 330 frames",
      warning: null,
    });
  });
});

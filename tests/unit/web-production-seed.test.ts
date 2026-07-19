import { describe, expect, test } from "vitest";
import {
  contractDefaultProfile,
  contractOutputs,
  contractPreflight,
  contractProfiles,
  contractQaWorkspace,
  contractQueue,
  contractReceipt,
} from "../../apps/studio-web/src/delivery-seed.js";
import { initialStudioSnapshot } from "../../apps/studio-web/src/runtime-snapshot.js";

describe("production web seeds", () => {
  test("starts without fabricated delivery authority", () => {
    expect(contractDefaultProfile.name).toBe("Loading local profiles");
    expect(contractProfiles).toEqual([]);
    expect(contractQueue).toEqual([]);
    expect(contractOutputs).toEqual([]);
    expect(contractPreflight).toMatchObject({ executable: false, findings: [] });
    expect(contractQaWorkspace).toMatchObject({
      outputId: "output-unavailable",
      latest: null,
      checklist: null,
    });
    expect(contractReceipt).toEqual({});
  });

  test("starts without a browser-only project or timeline sample", () => {
    expect(initialStudioSnapshot.project).toBeNull();
    expect(initialStudioSnapshot.preview.durationFrames).toBe("0");
    expect(initialStudioSnapshot.timeline.trackIds).toEqual([]);
    expect(initialStudioSnapshot.timeline.clips).toEqual({});
    expect(initialStudioSnapshot.assets).toEqual([]);
    expect(initialStudioSnapshot.render).toMatchObject({
      status: "idle",
      stage: "No project open",
      qa: "not-run",
    });
  });
});

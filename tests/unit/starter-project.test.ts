import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSessionService } from "../../apps/studio-server/src/index.js";
import { timelineDocumentToSnapshot } from "../../packages/timeline/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Launch Film starter project", () => {
  it("creates an editable persisted timeline instead of a browser-only sample", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-launch-film-"));
    temporaryDirectories.push(parent);
    const service = new ProjectSessionService();
    await service.create({
      targetPath: path.join(parent, "Launch Film.chai"),
      title: "Launch Film",
      starter: "launch-film",
    });
    const snapshot = await service.snapshot();
    expect(() => timelineDocumentToSnapshot(snapshot.timeline)).not.toThrow();
    const clips = snapshot.timeline.tracks.flatMap((track) => track.clips);

    expect(snapshot.project.title).toBe("Launch Film");
    expect(await service.revisionHistory()).toHaveLength(2);
    expect(snapshot.timeline.durationFrames).not.toBe("0");
    expect(clips.length).toBeGreaterThan(0);
    expect(snapshot.assets.assets.length).toBeGreaterThan(0);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(clips.length);

    await service.close();
    await service.open(path.join(parent, "Launch Film.chai"));
    const reopened = await service.snapshot();
    expect(reopened.pointer.revisionId).toBe(snapshot.pointer.revisionId);
    expect(reopened.timeline.tracks.flatMap((track) => track.clips)).toHaveLength(clips.length);
  });

  it("creates the production showcase from local validated renderable media", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-showcase-"));
    temporaryDirectories.push(parent);
    const root = path.join(parent, "Chai Studio Intro.chai");
    const service = new ProjectSessionService();
    await service.create({
      targetPath: root,
      title: "Chai Studio Intro",
      starter: "showcase",
    });
    const snapshot = await service.snapshot();
    const clips = snapshot.timeline.tracks.flatMap((track) => track.clips);

    expect(snapshot.project.title).toBe("Chai Studio Intro");
    expect(snapshot.timeline.durationFrames).toBe("450");
    expect(snapshot.timeline.tracks).toHaveLength(1);
    expect(clips).toHaveLength(3);
    expect(snapshot.assets.assets).toHaveLength(3);
    expect(clips.every((clip) => clip.properties?.["transform.opacity"]?.value === 100)).toBe(true);
    expect(snapshot.assets.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          rights: "owned",
          validationState: "valid",
        }),
      ]),
    );
    for (const asset of snapshot.assets.assets) {
      const bytes = await readFile(path.join(root, asset.path));
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    expect(snapshot.project.rightsNotes).toContain(
      "The Chai Studio starter artwork is generated locally and marked owned for this project.",
    );
  });
});

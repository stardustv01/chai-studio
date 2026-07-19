import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reviewed visual goldens", () => {
  it("matches every checksum in the explicit golden manifest", async () => {
    const manifestPath = path.resolve("fixtures/goldens/checksum-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Record<string, string> };
    const snapshotFiles = await discoverSnapshotFiles(path.resolve("tests/e2e"));
    expect(
      Object.keys(manifest.files)
        .filter((file) => file.includes("-snapshots/") && file.endsWith(".png"))
        .sort(),
      "Every reviewed Playwright PNG must be governed by the explicit manifest.",
    ).toEqual(snapshotFiles);
    for (const [file, expected] of Object.entries(manifest.files)) {
      const actual = createHash("sha256")
        .update(await readFile(path.resolve(file)))
        .digest("hex");
      expect(actual, file).toBe(expected);
    }
  });
});

const discoverSnapshotFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await discoverSnapshotFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith(".png") && directory.endsWith("-snapshots")) {
      files.push(path.relative(process.cwd(), absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
};

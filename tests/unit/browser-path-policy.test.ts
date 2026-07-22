import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pathIsWithinAnyRoot, playwrightCacheRoots } from "../../scripts/browser-path-policy.mjs";

describe("Playwright browser path policy", () => {
  it("accepts a managed executable under a custom cache root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chai-playwright-cache-"));
    const executable = path.join(root, "chromium-1228", "chrome-linux", "chrome");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "test");

    expect(await pathIsWithinAnyRoot(executable, [root])).toBe(true);
    expect(playwrightCacheRoots({ configuredPath: root, home: "/unused-home" })).toContain(root);
  });

  it("rejects an executable outside every managed cache root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chai-playwright-cache-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "chai-browser-outside-"));
    const executable = path.join(outside, "chrome");
    await writeFile(executable, "test");

    expect(await pathIsWithinAnyRoot(executable, [root])).toBe(false);
  });

  it("rejects a symlink that escapes a managed cache root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chai-playwright-cache-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "chai-browser-outside-"));
    const executable = path.join(outside, "chrome");
    const link = path.join(root, "chromium-1228");
    await writeFile(executable, "test");
    await symlink(outside, link);

    expect(await pathIsWithinAnyRoot(path.join(link, "chrome"), [root])).toBe(false);
  });
});

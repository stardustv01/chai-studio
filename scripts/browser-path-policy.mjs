import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function playwrightCacheRoots({
  configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH,
  home = os.homedir(),
} = {}) {
  return [
    configuredPath,
    path.join(home, "Library", "Caches", "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
  ].filter(Boolean);
}

export async function pathIsWithinAnyRoot(candidate, roots) {
  const resolvedCandidate = await realpath(candidate);
  for (const root of roots) {
    let resolvedRoot;
    try {
      resolvedRoot = await realpath(root);
    } catch {
      continue;
    }
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    ) {
      return true;
    }
  }
  return false;
}

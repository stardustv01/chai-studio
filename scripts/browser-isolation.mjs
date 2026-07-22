import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { pathIsWithinAnyRoot, playwrightCacheRoots } from "./browser-path-policy.mjs";

const systemChrome = path.normalize("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function managedChromiumFromCache() {
  const cacheRoots = playwrightCacheRoots();
  const suffixes = [
    path.join(
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    path.join(
      "chrome-mac",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    path.join("chrome-linux", "chrome"),
  ];

  for (const cacheRoot of cacheRoots) {
    let builds;
    try {
      builds = (await readdir(cacheRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => Number(right.slice(9)) - Number(left.slice(9)));
    } catch {
      continue;
    }
    for (const build of builds) {
      for (const suffix of suffixes) {
        const candidate = path.join(cacheRoot, build, suffix);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  throw new Error(
    "No Playwright-managed Chromium executable is available. Install the pinned Playwright browser before running browser gates.",
  );
}

async function managedHeadlessShellFromCache() {
  const cacheRoots = playwrightCacheRoots();
  const suffixes = [
    path.join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
    path.join("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    path.join("chrome-headless-shell-mac", "chrome-headless-shell"),
    path.join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  ];

  for (const cacheRoot of cacheRoots) {
    let builds;
    try {
      builds = (await readdir(cacheRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^chromium_headless_shell-\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => Number(right.split("-").at(-1)) - Number(left.split("-").at(-1)));
    } catch {
      continue;
    }
    for (const build of builds) {
      for (const suffix of suffixes) {
        const candidate = path.join(cacheRoot, build, suffix);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  throw new Error(
    "No Playwright-managed Chromium headless shell is available. Install the pinned Playwright browser before running real-engine gates.",
  );
}

async function resolveManagedChromium() {
  try {
    const { chromium } = await import("@playwright/test");
    return chromium.executablePath();
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return managedChromiumFromCache();
  }
}

export const isolatedChromiumExecutable = path.normalize(await resolveManagedChromium());
export const isolatedEngineExecutable = path.normalize(await managedHeadlessShellFromCache());
export const isolatedRemotionExecutable = isolatedEngineExecutable;

for (const executable of [isolatedChromiumExecutable, isolatedEngineExecutable]) {
  if (executable === systemChrome || executable.startsWith(`${path.dirname(systemChrome)}${path.sep}`)) {
    throw new Error("Browser isolation refused the installed Google Chrome executable.");
  }
  if (!(await pathIsWithinAnyRoot(executable, playwrightCacheRoots()))) {
    throw new Error(`Browser isolation requires a Playwright-managed executable, received: ${executable}`);
  }
}

const managedBuild = isolatedChromiumExecutable.split(path.sep).find((part) => part.startsWith("chromium-"));
export const isolatedChromiumIdentity = `playwright-managed:${managedBuild ?? "chromium"}`;
const engineBuild = isolatedEngineExecutable
  .split(path.sep)
  .find((part) => part.startsWith("chromium_headless_shell-"));
export const isolatedEngineIdentity = `playwright-managed:${engineBuild ?? "chromium-headless-shell"}`;
export const isolatedRemotionIdentity = isolatedEngineIdentity;

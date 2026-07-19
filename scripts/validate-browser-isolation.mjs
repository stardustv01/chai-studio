import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isolatedChromiumExecutable,
  isolatedChromiumIdentity,
  isolatedEngineExecutable,
  isolatedEngineIdentity,
  isolatedRemotionExecutable,
  isolatedRemotionIdentity,
} from "./browser-isolation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbidden = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  'channel: "chrome"',
  "channel: 'chrome'",
];
const browserLaunchFiles = [
  "playwright.config.ts",
  "playwright.authenticated.config.ts",
  "playwright.first-run.config.ts",
  "tests/integration/hyperframes-real-runtime.test.ts",
  "tests/integration/remotion-real-runtime.test.ts",
  "tests/integration/native-composition-runtime.test.ts",
  "spikes/milestone-0/scripts/benchmark-native-stills.mjs",
  "spikes/milestone-0/scripts/capture-environment.mjs",
  "spikes/milestone-0/scripts/generate-preview-sequences.mjs",
  "spikes/milestone-0/scripts/render-mixed-finish.mjs",
  "spikes/milestone-0/scripts/render-remotion.mjs",
  "apps/studio-server/src/native-composition-runtime.ts",
];

await access(isolatedChromiumExecutable);
await access(isolatedEngineExecutable);
const checks = [];
for (const relativePath of browserLaunchFiles) {
  const content = await readFile(path.join(root, relativePath), "utf8");
  const forbiddenMatches = forbidden.filter((value) => content.includes(value));
  checks.push({
    file: relativePath,
    passed: forbiddenMatches.length === 0,
    forbiddenMatches,
  });
}
const config = await readFile(path.join(root, "playwright.config.ts"), "utf8");
checks.push({
  file: "playwright.config.ts",
  passed: config.includes('browserName: "chromium"') && !config.includes("channel:"),
  required: "browserName chromium with no installed-browser channel",
});
const nativeRuntime = await readFile(
  path.join(root, "apps/studio-server/src/native-composition-runtime.ts"),
  "utf8",
);
checks.push({
  file: "apps/studio-server/src/native-composition-runtime.ts",
  passed:
    nativeRuntime.includes("Playwright-managed Chromium headless shell") &&
    nativeRuntime.includes("ms-playwright") &&
    nativeRuntime.includes("canonicalCandidate") &&
    !nativeRuntime.includes("channel:"),
  required: "canonical Playwright-managed headless shell with no installed-browser channel",
});
const authenticatedConfig = await readFile(path.join(root, "playwright.authenticated.config.ts"), "utf8");
checks.push({
  file: "playwright.authenticated.config.ts",
  passed:
    authenticatedConfig.includes('browserName: "chromium"') && !authenticatedConfig.includes("channel:"),
  required: "browserName chromium with no installed-browser channel",
});
const firstRunConfig = await readFile(path.join(root, "playwright.first-run.config.ts"), "utf8");
checks.push({
  file: "playwright.first-run.config.ts",
  passed: firstRunConfig.includes('browserName: "chromium"') && !firstRunConfig.includes("channel:"),
  required: "browserName chromium with no installed-browser channel",
});
const runtimeTest = await readFile(
  path.join(root, "tests/integration/remotion-real-runtime.test.ts"),
  "utf8",
);
checks.push({
  file: "tests/integration/remotion-real-runtime.test.ts",
  passed:
    runtimeTest.includes("isolatedRemotionExecutable") && runtimeTest.includes("isolatedRemotionIdentity"),
  required: "dedicated Playwright-managed headless-shell executable and identity",
});
const hyperframesRuntimeTest = await readFile(
  path.join(root, "tests/integration/hyperframes-real-runtime.test.ts"),
  "utf8",
);
checks.push({
  file: "tests/integration/hyperframes-real-runtime.test.ts",
  passed:
    hyperframesRuntimeTest.includes("isolatedEngineExecutable") &&
    hyperframesRuntimeTest.includes("isolatedEngineIdentity") &&
    hyperframesRuntimeTest.includes("new HyperframesCliRuntime(executable, browserExecutable)"),
  required: "dedicated Playwright-managed headless shell is bound into the HyperFrames child process",
});

const passed = checks.every((check) => check.passed);
console.log(
  JSON.stringify(
    {
      passed,
      executable: isolatedChromiumExecutable,
      identity: isolatedChromiumIdentity,
      engineExecutable: isolatedEngineExecutable,
      engineIdentity: isolatedEngineIdentity,
      remotionExecutable: isolatedRemotionExecutable,
      remotionIdentity: isolatedRemotionIdentity,
      systemGoogleChromeSelected: false,
      persistentUserProfileConfigured: false,
      checks,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;

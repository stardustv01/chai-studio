import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
for (const owner of ["apps", "packages"]) {
  for (const entry of await readdir(path.join(root, owner), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, owner, entry.name);
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    for (const lifecycle of ["preinstall", "install", "postinstall"]) {
      if (manifest.scripts?.[lifecycle] !== undefined)
        problems.push(`${manifest.name}: forbidden ${lifecycle} script`);
    }
    for (const file of await runtimeFiles(path.join(directory, "src"))) {
      const source = await readFile(file, "utf8");
      if (/\b(?:eval|Function)\s*\(/.test(source)) problems.push(`${file}: dynamic code execution`);
      for (const match of source.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
        const line = sourceLineAt(source, match.index ?? 0);
        if (
          !isLoopbackAuthority(match[1]) &&
          !isSchemaIdentifier(file, line) &&
          !isInboundHostParser(file, line) &&
          !isStaticMarkupNamespace(match[1], line)
        ) {
          problems.push(`${file}: undeclared runtime network origin ${match[1]}`);
        }
      }
    }
  }
}

const browserLaunchFiles = [
  "playwright.config.ts",
  "playwright.authenticated.config.ts",
  "playwright.first-run.config.ts",
  "tests/integration/hyperframes-real-runtime.test.ts",
  "tests/integration/remotion-real-runtime.test.ts",
  "spikes/milestone-0/scripts/benchmark-native-stills.mjs",
  "spikes/milestone-0/scripts/capture-environment.mjs",
  "spikes/milestone-0/scripts/generate-preview-sequences.mjs",
  "spikes/milestone-0/scripts/render-mixed-finish.mjs",
  "spikes/milestone-0/scripts/render-remotion.mjs",
];
for (const relativePath of browserLaunchFiles) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  if (source.includes("/Applications/Google Chrome.app")) {
    problems.push(`${relativePath}: installed Google Chrome launch is forbidden`);
  }
  if (/channel:\s*["']chrome["']/.test(source)) {
    problems.push(`${relativePath}: installed Chrome Playwright channel is forbidden`);
  }
}

function isLoopbackAuthority(authority) {
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(authority);
}

function isSchemaIdentifier(file, line) {
  const schemaProperty = /^\s*(?:"\$(?:schema|id|ref)"|\$(?:schema|id))\s*:/.test(line);
  return (
    schemaProperty &&
    (file.includes(`${path.sep}generated${path.sep}`) || file.endsWith(`${path.sep}manifests.ts`))
  );
}

function isInboundHostParser(file, line) {
  return (
    file.endsWith(`${path.sep}request-security.ts`) &&
    line.includes("new URL(`http://${hostHeader}`).hostname")
  );
}

function isStaticMarkupNamespace(authority, line) {
  return authority === "www.w3.org" && line.includes('xmlns="http://www.w3.org/2000/svg"');
}

function sourceLineAt(source, index) {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end === -1 ? source.length : end);
}
console.log(
  JSON.stringify({ passed: problems.length === 0, unsolicitedTelemetry: false, problems }, null, 2),
);
if (problems.length > 0) process.exitCode = 1;

async function runtimeFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await runtimeFiles(target)));
    else if (/\.(?:ts|tsx|css)$/.test(entry.name)) files.push(target);
  }
  return files;
}

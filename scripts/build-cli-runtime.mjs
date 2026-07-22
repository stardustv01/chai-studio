import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(root, "packages/cli");
const runtimeRoot = path.join(packageRoot, "runtime");
const rootManifest = await readJson(path.join(root, "package.json"));
const cliManifest = await readJson(path.join(packageRoot, "package.json"));
const chaiWorkspaceEntries = await workspaceExportEntries();
const declaredRuntimePackages = new Set(Object.keys(cliManifest.dependencies ?? {}));

if (rootManifest.version !== cliManifest.version || cliManifest.license !== "Apache-2.0") {
  throw new Error("CLI and Chai Studio release identities must match before runtime packaging.");
}
await requireFile(path.join(root, "apps/studio-server/dist/index.js"));
await requireFile(path.join(root, "apps/studio-web/dist/index.html"));

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(path.join(runtimeRoot, "apps/studio-server/dist"), { recursive: true });
const bundle = await build({
  entryPoints: [path.join(root, "apps/studio-server/dist/index.js")],
  outfile: path.join(runtimeRoot, "apps/studio-server/dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  metafile: true,
  legalComments: "none",
  packages: "external",
  plugins: [
    {
      name: "bundle-chai-workspace-code",
      setup(context) {
        context.onResolve({ filter: /^@chai-studio\// }, (args) => {
          const resolved = chaiWorkspaceEntries.get(args.path);
          if (resolved === undefined) {
            return { errors: [{ text: `Unknown Chai workspace export: ${args.path}` }] };
          }
          return { path: resolved };
        });
      },
    },
  ],
});
const externalSpecifiers = [
  ...new Set(
    Object.values(bundle.metafile.outputs)
      .flatMap((output) => output.imports)
      .map((entry) => entry.path)
      .filter((specifier) => !specifier.startsWith("node:")),
  ),
].sort();
const externalPackages = [...new Set(externalSpecifiers.map(packageName))].sort();
const unexpectedImports = externalPackages.filter(
  (packageNameValue) => !declaredRuntimePackages.has(packageNameValue),
);
if (unexpectedImports.length > 0) {
  throw new Error(`CLI runtime contains undeclared external imports: ${unexpectedImports.join(", ")}`);
}

await cp(path.join(root, "apps/studio-web/dist"), path.join(runtimeRoot, "apps/studio-web/dist"), {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});
const hyperframesPackageRoot = await realpath(
  path.join(root, "packages/engine-adapters/node_modules/hyperframes"),
);
const hyperframesManifest = await readJson(path.join(hyperframesPackageRoot, "package.json"));
if (hyperframesManifest.version !== "0.7.58" || hyperframesManifest.license !== "Apache-2.0") {
  throw new Error("The vendored HyperFrames CLI does not match the reviewed release identity.");
}
const hyperframesRuntimeFiles = [
  "beat-analyzer.global.js",
  "cli.js",
  "commands/contrast-audit.browser.js",
  "commands/layout-audit.browser.js",
  "commands/motion-sample.browser.js",
  "hyperframe-runtime.js",
  "hyperframe.manifest.json",
  "hyperframe.runtime.iife.js",
  "hyperframes-player.global.js",
  "hyperframes-slideshow.global.js",
  "shaderTransitionWorker.js",
];
const bundledHyperframesFiles = [];
for (const file of hyperframesRuntimeFiles) {
  const source = path.join(hyperframesPackageRoot, "dist", file);
  const destination = path.join(runtimeRoot, "vendor/hyperframes", file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: false, errorOnExist: true });
  const bytes = await readFile(destination);
  bundledHyperframesFiles.push({
    path: `vendor/hyperframes/${file}`,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const relative of [
  "scripts/browser-isolation.mjs",
  "scripts/browser-path-policy.mjs",
  "scripts/chai-studio.mjs",
  "scripts/release-bundle.mjs",
  "scripts/release-operations.mjs",
  "scripts/runtime-web-server.mjs",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "pnpm-lock.yaml",
  "governance/licenses/dependency-inventory.json",
  "governance/licenses/release-review.json",
]) {
  await copyRelative(relative);
}
await writeFile(
  path.join(runtimeRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "@chai-studio/registry-runtime",
      version: rootManifest.version,
      private: true,
      type: "module",
      license: "Apache-2.0",
    },
    null,
    2,
  )}\n`,
);
const serverBytes = await readFile(path.join(runtimeRoot, "apps/studio-server/dist/index.js"));
const marker = {
  schemaVersion: "1.0.0",
  product: "Chai Studio registry runtime",
  version: rootManifest.version,
  license: "Apache-2.0",
  thirdPartyDelivery: "npm-direct-dependencies-with-vendored-hyperframes-cli",
  ffmpegDelivery: "external-system-tool",
  bundledChaiServerSha256: createHash("sha256").update(serverBytes).digest("hex"),
  externalPackages,
  runtimeDependencies: cliManifest.dependencies,
  bundledHyperframesCli: {
    version: hyperframesManifest.version,
    license: hyperframesManifest.license,
    sourceRepository: "https://github.com/heygen-com/hyperframes",
    files: bundledHyperframesFiles,
  },
  bundledBrowserLibraries: [
    {
      names: ["react", "react-dom", "scheduler"],
      license: "MIT",
      licenseText: "apps/studio-web/dist/third-party/react-mit.txt",
    },
  ],
  bundledFonts: [
    {
      family: "Noto Sans Devanagari",
      weights: ["Regular", "Medium", "SemiBold"],
      license: "OFL-1.1",
      licenseText: "apps/studio-web/dist/fonts/OFL.txt",
    },
  ],
};
await writeFile(
  path.join(runtimeRoot, ".chai-studio-registry-runtime.json"),
  `${JSON.stringify(marker, null, 2)}\n`,
);
if (process.env.npm_lifecycle_event !== "prepack") {
  process.stdout.write(
    `${JSON.stringify({ built: true, version: marker.version, runtimeRoot, externalPackages }, null, 2)}\n`,
  );
}

async function copyRelative(relative) {
  const destination = path.join(runtimeRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, relative), destination, { force: false, errorOnExist: true });
}

async function requireFile(file) {
  const metadata = await stat(file).catch(() => null);
  if (metadata === null || !metadata.isFile())
    throw new Error(`Required CLI runtime file is missing: ${file}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function workspaceExportEntries() {
  const entries = new Map();
  const packagesRoot = path.join(root, "packages");
  for (const directory of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name === "cli") continue;
    const packageDirectory = path.join(packagesRoot, directory.name);
    const manifest = await readJson(path.join(packageDirectory, "package.json"));
    for (const [exportName, target] of Object.entries(manifest.exports ?? {})) {
      const importTarget = typeof target === "string" ? target : target.import;
      if (typeof importTarget !== "string") continue;
      const specifier = `${manifest.name}${exportName === "." ? "" : exportName.slice(1)}`;
      entries.set(specifier, path.join(packageDirectory, importTarget));
    }
  }
  return entries;
}

function packageName(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

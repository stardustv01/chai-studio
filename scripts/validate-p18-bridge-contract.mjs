import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P18.01-P18.02",
    "packages/bridge/src/manifests.ts",
    [
      "SelectionContextManifest",
      "selectionContextJsonSchema",
      "masterFrame",
      "sourceFrames",
      "timecode",
      "nearbyClips",
      "captureIds",
      "annotationIds",
      "writeLatestContext",
      ".chai-context",
      "latest-context.json",
      "assertFreshContext",
    ],
  ],
  [
    "P18.03-P18.05",
    "packages/bridge/src/capture-jobs.ts",
    ["CaptureJobManager", "AbortController", "cancel", "writeCaptureManifest"],
  ],
  [
    "P18.03-P18.04",
    "packages/bridge/src/manifests.ts",
    [
      "CaptureManifest",
      "captureManifestJsonSchema",
      "current-frame",
      "isolated-selection",
      "before-effects",
      "comparison-a",
      "contact-sheet",
      "parityEligible",
      "outputHashes",
      "final-compositor",
      "interactive",
      "fidelity",
      "assertCaptureManifest",
    ],
  ],
  [
    "P18.06-P18.07",
    "packages/schema/src/project-documents.ts",
    [
      "AnnotationGeometry",
      "AnnotationDocument",
      "source-normalized",
      "blur-privacy",
      "privacyBehavior",
      "redact-preview-and-export",
      "frameRange",
      "visible",
      "locked",
      "order",
    ],
  ],
  [
    "P18.06-P18.07",
    "packages/bridge/src/annotations.ts",
    [
      "annotation.create",
      "annotation.update",
      "annotation.delete",
      "executeAnnotationDocumentEdit",
      "Unlock the annotation",
      "normalized to source space",
    ],
  ],
  [
    "P18.07",
    "packages/schema/src/command-envelope.ts",
    [
      "annotation.edit",
      "AnnotationEditCommand",
      "annotation.create",
      "annotation.update",
      "annotation.delete",
    ],
  ],
  [
    "P18.08-P18.10",
    "packages/bridge/src/discovery.ts",
    [
      "status",
      "selection.get",
      "selection.set",
      "capture.current",
      "capture.range",
      "context.latest",
      "preview.start",
      "render.start",
      "qa.latest",
      "source.edit.begin",
      "source.edit.commit",
      "source.edit.abort",
      "networkPush",
    ],
  ],
  [
    "P18.08-P18.11",
    "packages/bridge/src/cli-runtime.ts",
    [
      "Readonly<Record<BridgeCommandName, CommandHandler>>",
      '"render.start"',
      '"render.status"',
      '"capture.current"',
      '"capture.range"',
      '"qa.run"',
      '"qa.latest"',
      '"receipt.get"',
      '"asset.upload"',
      '"command.apply"',
      '"source.edit.commit"',
      "/api/v1/captures/from-render",
      "waitForJob",
      "waitForPreview",
      "discoverBridgeAttachment",
    ],
  ],
  [
    "P18.08-P18.10",
    "packages/bridge/src/client.ts",
    ["BridgeApiClient", "Readable.toWeb", "authorization", "download", "local HTTP server"],
  ],
  [
    "P18.09-P18.10",
    "packages/bridge/src/attachment.ts",
    [
      "discoverBridgeAttachment",
      "bridge-session.json",
      "assertPrivateFile",
      "process.getuid",
      "processIsAlive",
      "expiresAt",
    ],
  ],
  [
    "P18.08-P18.10",
    "scripts/chai-studio.mjs",
    ["runBridgeCli", "releaseCommands", "packages/bridge/dist/cli-runtime.js"],
  ],
  [
    "P18.09-P18.14",
    "apps/studio-server/src/index.ts",
    [
      "createBridgeAuthorization",
      "publishStudioBridgeSession",
      "bridgeCapabilityForRequest",
      "interactionService.subscribe",
      "bridgeRestricted",
    ],
  ],
  [
    "P18.09-P18.10",
    "apps/studio-server/src/request-security.ts",
    [
      "authenticateBridgeRequest",
      "authorizeBridgeRequest",
      "server.bridge-capability-forbidden",
      'authentication: "public" | "session" | "bridge"',
    ],
  ],
  [
    "P18.14",
    "tests/integration/bridge-cli-control-loop.test.ts",
    [
      "scripts/chai-studio.mjs",
      "asset",
      "capture",
      "render",
      "receipt",
      "qa",
      "rendered-fidelity",
      "bridge-capability-forbidden",
    ],
  ],
  [
    "P18.09",
    "packages/bridge/src/authorization.ts",
    ["BridgeAuthorization", "BridgeCapability", "timingSafeEqual", "authorizeBridgeRequest", "expiresAt"],
  ],
  [
    "P18.12",
    "packages/bridge/src/redaction.ts",
    ["redactBridgeValue", "redactValueWithContext", "createBridgeLogRecord"],
  ],
  [
    "P18.12",
    "packages/diagnostics/src/index.ts",
    ["authorization", "cookie", "password", "secret", "token", "Bearer [REDACTED]"],
  ],
  [
    "P18.12",
    "tests/property/redaction.property.test.ts",
    ["never retains generated token values", "redacts bearer tokens", "[REDACTED]"],
  ],
  [
    "P18.02-P18.13",
    "apps/studio-server/src/interaction-service.ts",
    [
      "writeLatestContext",
      "#queueContextRefresh",
      "preview.subscribe",
      "projects.subscribe",
      "contextEngine",
      "frameToTimecode",
      "annotation.edit",
      "assertCommitted",
    ],
  ],
  [
    "P18.06-P18.14",
    "apps/studio-web/src/workspace-content.tsx",
    [
      "Codex context",
      "Copy exact context",
      "Capture jobs",
      "Fidelity frame",
      "Before effects",
      "Privacy only",
      "Add at frame",
      "source-normalized",
      "No second chat or remote push exists",
    ],
  ],
  [
    "P18.14",
    "tests/integration/server-interaction-api.test.ts",
    [
      "latest-context.json",
      "bridge/discovery",
      "annotationIds",
      "historyCommand",
      "undo",
      "redo",
      "source-edits",
    ],
  ],
];

const results = [];
for (const [task, file, symbols] of checks) {
  let content = "";
  let exists = true;
  try {
    content = await readFile(path.join(root, file), "utf8");
  } catch {
    exists = false;
  }
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({ task, file, passed: exists && missingSymbols.length === 0, exists, missingSymbols });
}

const discoverySource = await readFile(path.join(root, "packages/bridge/src/discovery.ts"), "utf8");
const runtimeSource = await readFile(path.join(root, "packages/bridge/src/cli-runtime.ts"), "utf8");
const catalogNames = [...discoverySource.matchAll(/^\s+name: "([a-z][a-z0-9.]+)",$/gmu)].map(
  (match) => match[1],
);
const handlerBlock = runtimeSource.slice(
  runtimeSource.indexOf("const commandHandlers:"),
  runtimeSource.indexOf("const parseCli ="),
);
const handlerNames = [...handlerBlock.matchAll(/^\s+(?:"([a-z][a-z0-9.]+)"|(status)):/gmu)].map(
  (match) => match[1] ?? match[2],
);
const missingHandlers = catalogNames.filter((name) => !handlerNames.includes(name));
const undiscoveredHandlers = handlerNames.filter((name) => !catalogNames.includes(name));
results.push({
  task: "P18.08-P18.10",
  file: "packages/bridge/src/discovery.ts -> packages/bridge/src/cli-runtime.ts",
  passed:
    catalogNames.length >= 40 &&
    missingHandlers.length === 0 &&
    undiscoveredHandlers.length === 0 &&
    !runtimeSource.includes("requires a PNG input path"),
  exists: true,
  missingSymbols: [
    ...missingHandlers.map((name) => `handler:${name}`),
    ...undiscoveredHandlers.map((name) => `discovery:${name}`),
    ...(catalogNames.length >= 40 ? [] : ["at-least-40-executable-commands"]),
    ...(!runtimeSource.includes("requires a PNG input path") ? [] : ["remove-external-png-requirement"]),
  ],
});

for (const file of [
  "tests/unit/bridge-context-capture.test.ts",
  "tests/integration/server-interaction-api.test.ts",
  "tests/e2e/studio-visual.spec.ts",
  "packages/bridge/src/cli.ts",
  "tests/integration/bridge-cli-control-loop.test.ts",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P18.14", file, passed: exists, exists, missingSymbols: [] });
}

const visualDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
let visualFiles;
try {
  visualFiles = (await readdir(visualDirectory)).filter((file) => file.endsWith("-darwin.png")).sort();
} catch {
  visualFiles = [];
}
const requiredVisuals = ["p08-inspect-workspace-darwin.png", "p18-codex-context-bridge-darwin.png"];
for (const requiredVisual of requiredVisuals) {
  results.push({
    task: "P18.14",
    file: path.relative(root, path.join(visualDirectory, requiredVisual)),
    passed: visualFiles.includes(requiredVisual),
    exists: visualFiles.includes(requiredVisual),
    missingSymbols: [],
  });
}

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P18", taskRange: "P18.01-P18.14", passed, results }, null, 2));
if (!passed) process.exitCode = 1;

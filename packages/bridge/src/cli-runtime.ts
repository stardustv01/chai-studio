import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverBridgeAttachment } from "./attachment.js";
import { BridgeApiClient } from "./client.js";
import { bridgeCommandCatalog, bridgeDiscoveryDocument, type BridgeCommandName } from "./discovery.js";

interface ParsedCli {
  readonly client: BridgeApiClient;
  readonly command: BridgeCommandName | null;
  readonly input: CommandInput;
}

interface CommandInput {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

type CommandHandler = (client: BridgeApiClient, input: CommandInput) => Promise<unknown>;

const actor = { id: "codex-bridge", kind: "codex", sessionId: "codex-local-session" } as const;

export const runBridgeCli = async (argv: readonly string[]): Promise<unknown> => {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "commands") {
    return bridgeDiscoveryDocument;
  }
  const parsed = await parseCli(argv);
  if (parsed.command === null) return bridgeDiscoveryDocument;
  const handler = commandHandlers[parsed.command];
  if (handler === undefined) throw new Error(`Bridge command ${parsed.command} has no executable handler.`);
  return handler(parsed.client, parsed.input);
};

const commandHandlers: Readonly<Record<BridgeCommandName, CommandHandler>> = {
  status: (client) => client.request("GET", "/api/health"),
  "project.create": (client, input) =>
    client.request("POST", "/api/v1/projects/create", {
      targetPath: requirePositional(input, 0, "project create requires a target path."),
      title: requirePositional(input, 1, "project create requires a title."),
      starter: option(input, "starter") ?? "empty",
    }),
  "project.open": (client, input) =>
    client.request("POST", "/api/v1/projects/open", {
      rootPath: requirePositional(input, 0, "project open requires a project path."),
    }),
  "project.close": (client) => client.request("POST", "/api/v1/projects/close", {}),
  "project.snapshot": (client) => client.request("GET", "/api/v1/projects/current/snapshot"),
  "project.revisions": (client) => client.request("GET", "/api/v1/projects/current/revisions"),
  "project.recent": (client) => client.request("GET", "/api/v1/projects/recent"),
  "project.named-versions": (client) => client.request("GET", "/api/v1/projects/current/named-versions"),
  "project.migration": (client) => client.request("GET", "/api/v1/projects/current/migration-report"),
  "project.repair": (client) => client.request("GET", "/api/v1/projects/current/repair-report"),
  "selection.get": (client) => client.request("GET", "/api/v1/editor/selection"),
  "selection.set": async (client, input) => {
    const current = record(await client.request("GET", "/api/v1/editor/selection"), "selection");
    return client.request("PUT", "/api/v1/editor/selection", {
      ids: input.positional,
      primaryId: input.positional[0] ?? null,
      anchorId: null,
      mode: "replace",
      expectedStateVersion: integerField(current, "stateVersion"),
    });
  },
  "context.latest": (client) => client.request("GET", "/api/v1/editor/context"),
  "asset.upload": uploadAsset,
  "asset.import": importAsset,
  "asset.search": searchAssets,
  "asset.inspect": (client, input) => assetJob(client, input, "inspect"),
  "asset.proxy": (client, input) => assetJob(client, input, "proxy-default"),
  "asset.usage": (client, input) =>
    client.request("GET", `/api/v1/assets/${encodeURIComponent(requireAssetId(input))}/usage`),
  "asset.relink": (client, input) => mutateAsset(client, input, "relink"),
  "asset.replace": (client, input) => mutateAsset(client, input, "replace"),
  "asset.rights": updateAssetRights,
  "asset.frame": async (client, input) => {
    const assetId = requireAssetId(input);
    const targetFrame = frame(requirePositional(input, 1, "asset frame requires a frame."));
    const destination = requirePositional(input, 2, "asset frame requires a destination path.");
    const downloaded = await client.download(
      `/api/v1/assets/${encodeURIComponent(assetId)}/source-frame?frame=${encodeURIComponent(targetFrame)}`,
    );
    await writeFile(destination, downloaded.bytes, { flag: hasFlag(input, "overwrite") ? "w" : "wx" });
    return { assetId, frame: targetFrame, destination: path.resolve(destination), ...downloaded };
  },
  "preview.start": (client) => client.request("POST", "/api/v1/preview/sessions/load", {}),
  "preview.state": (client) => client.request("GET", "/api/v1/preview/sessions/current"),
  "preview.play": (client) => previewTransport(client, "play"),
  "preview.pause": (client) => previewTransport(client, "pause"),
  "preview.stop": (client) => previewTransport(client, "stop"),
  "preview.unload": (client) => client.request("POST", "/api/v1/preview/sessions/unload", {}),
  "preview.seek": (client, input) =>
    previewControl(client, "/api/v1/preview/sessions/current/seek", {
      frame: frame(requirePositional(input, 0, "preview seek requires a frame.")),
    }),
  "preview.step": (client, input) =>
    previewControl(client, "/api/v1/preview/sessions/current/step", {
      delta: safeInteger(requirePositional(input, 0, "preview step requires a delta."), "step delta"),
    }),
  "preview.quality": (client, input) => {
    const quality = requirePositional(input, 0, "preview quality requires a quality.");
    return previewControl(client, "/api/v1/preview/sessions/current/quality", {
      quality,
      truthMode:
        option(input, "truth") ?? (quality === "full" ? "rendered-fidelity" : "interactive-approximation"),
    });
  },
  "preview.rate": (client, input) => {
    const match = /^(\d+)\/(\d+)$/.exec(
      requirePositional(input, 0, "preview rate requires numerator/denominator."),
    );
    if (match === null || match[2] === "0") throw new Error("Preview rate is invalid.");
    return previewControl(client, "/api/v1/preview/sessions/current/play-rate", {
      playRate: { numerator: match[1], denominator: match[2] },
    });
  },
  "preview.in-out": (client, input) => {
    const value = requirePositional(input, 0, "preview in-out requires start:endExclusive or clear.");
    if (value === "clear") {
      return previewControl(client, "/api/v1/preview/sessions/current/in-out-range", { range: null });
    }
    const match = /^(\d+):(\d+)$/.exec(value);
    if (match === null || BigInt(match[2] ?? "0") <= BigInt(match[1] ?? "0")) {
      throw new Error("Preview in-out range is invalid.");
    }
    return previewControl(client, "/api/v1/preview/sessions/current/in-out-range", {
      range: { startFrame: frame(match[1] ?? ""), endFrameExclusive: frame(match[2] ?? "") },
    });
  },
  "preview.preload": (client, input) =>
    previewControl(client, "/api/v1/preview/sessions/current/preload", {
      beforeFrames: safeInteger(option(input, "before") ?? "30", "preload before"),
      afterFrames: safeInteger(option(input, "after") ?? "60", "preload after"),
    }),
  "capture.current": captureCurrent,
  "capture.range": captureRange,
  "capture.list": (client) => client.request("GET", "/api/v1/captures"),
  "render.profiles": (client) => client.request("GET", "/api/v1/renders/profiles"),
  "render.plan": async (client, input) => {
    const snapshot = await currentSnapshot(client);
    return renderPreflight(client, input, snapshot.revisionId);
  },
  "render.start": async (client, input) => {
    const started = await startRender(client, input);
    return hasFlag(input, "wait") ? waitForJob(client, started.jobId, timeout(input)) : started.value;
  },
  "render.status": (client, input) =>
    client.request("GET", `/api/v1/jobs/${encodeURIComponent(requireJobId(input))}`),
  "render.cancel": (client, input) =>
    client.request("POST", `/api/v1/renders/jobs/${encodeURIComponent(requireJobId(input))}/cancel`, {}),
  "render.retry": async (client, input) => {
    const value = await client.request(
      "POST",
      `/api/v1/renders/jobs/${encodeURIComponent(requireJobId(input))}/retry`,
      {},
    );
    const jobId = stringField(recordField(record(value, "render retry"), "job"), "id");
    return hasFlag(input, "wait") ? waitForJob(client, jobId, timeout(input)) : value;
  },
  "render.outputs": (client) => client.request("GET", "/api/v1/renders/outputs"),
  "render.output": (client, input) =>
    client.request("GET", `/api/v1/renders/outputs/${encodeURIComponent(requireOutputId(input))}`),
  "render.requests": (client) => client.request("GET", "/api/v1/renders/requests"),
  "render.queue": (client) => client.request("GET", "/api/v1/renders/queue"),
  "render.duplicate": async (client, input) => {
    const value = await client.request(
      "POST",
      `/api/v1/renders/jobs/${encodeURIComponent(requireJobId(input))}/duplicate`,
      {},
    );
    const jobId = stringField(recordField(record(value, "render duplicate"), "job"), "id");
    return hasFlag(input, "wait") ? waitForJob(client, jobId, timeout(input)) : value;
  },
  "render.reprioritize": (client, input) =>
    client.request("POST", `/api/v1/renders/jobs/${encodeURIComponent(requireJobId(input))}/reprioritize`, {
      priority: safeInteger(requiredOption(input, "priority"), "render priority"),
    }),
  "qa.run": qaRun,
  "qa.latest": async (client) => {
    const output = await latestOutput(client);
    return client.request("GET", `/api/v1/renders/outputs/${encodeURIComponent(output.id)}/qa`);
  },
  "qa.get": (client, input) =>
    client.request("GET", `/api/v1/renders/outputs/${encodeURIComponent(requireOutputId(input))}/qa`),
  "receipt.get": (client, input) =>
    client.request("GET", `/api/v1/renders/outputs/${encodeURIComponent(requireOutputId(input))}/receipt`),
  "artifact.get": async (client, input) => {
    const outputId = requireOutputId(input);
    const index = safeInteger(
      requirePositional(input, 1, "artifact get requires an index."),
      "artifact index",
    );
    const destination = requirePositional(input, 2, "artifact get requires a destination path.");
    const downloaded = await client.download(
      `/api/v1/renders/outputs/${encodeURIComponent(outputId)}/artifacts/${String(index)}`,
    );
    await writeFile(destination, downloaded.bytes, { flag: hasFlag(input, "overwrite") ? "w" : "wx" });
    return { outputId, index, destination: path.resolve(destination), ...downloaded };
  },
  "annotation.list": (client) => client.request("GET", "/api/v1/annotations"),
  "annotation.create": async (client, input) =>
    client.request("POST", "/api/v1/annotations", {
      ...(await jsonInput(requirePositional(input, 0, "annotation create requires a JSON file."))),
      author: actor,
    }),
  "annotation.update": async (client, input) =>
    client.request(
      "PATCH",
      `/api/v1/annotations/${encodeURIComponent(requirePositional(input, 0, "annotation update requires an ID."))}`,
      await jsonInput(requirePositional(input, 1, "annotation update requires a JSON file.")),
    ),
  "annotation.delete": (client, input) =>
    client.request(
      "DELETE",
      `/api/v1/annotations/${encodeURIComponent(requirePositional(input, 0, "annotation delete requires an ID."))}`,
    ),
  "comparison.list": (client) => client.request("GET", "/api/v1/comparisons"),
  "comparison.create": (client, input) =>
    client.request("POST", "/api/v1/comparisons", {
      leftCaptureId: requirePositional(input, 0, "comparison create requires a left capture."),
      rightCaptureId: requirePositional(input, 1, "comparison create requires a right capture."),
      mode: option(input, "mode") ?? "wipe",
      split: boundedNumber(option(input, "split") ?? "0.5", "comparison split", 0, 1),
    }),
  "comparison.delete": (client, input) =>
    client.request(
      "DELETE",
      `/api/v1/comparisons/${encodeURIComponent(requirePositional(input, 0, "comparison delete requires an ID."))}`,
    ),
  "review.workspace": (client) => client.request("GET", "/api/v1/review/workspace"),
  "review.apply": async (client, input) => {
    const operation = await jsonInput(requirePositional(input, 0, "review apply requires a JSON file."));
    assertSafeReviewOperation(operation);
    return client.request("POST", "/api/v1/review/operations", { operation, actor });
  },
  "command.apply": (client, input) => executeCommandFile(client, input, false),
  "command.validate": (client, input) => executeCommandFile(client, input, true),
  "jobs.list": (client) => client.request("GET", "/api/v1/jobs"),
  "jobs.status": (client, input) =>
    client.request("GET", `/api/v1/jobs/${encodeURIComponent(requireJobId(input))}`),
  "jobs.cancel": (client, input) =>
    client.request("POST", `/api/v1/jobs/${encodeURIComponent(requireJobId(input))}/cancel`, {}),
  "source.edit.begin": (client, input) =>
    client.request("POST", "/api/v1/source-edits/begin", {
      path: requirePositional(input, 0, "source edit begin requires a project-relative path."),
      actor,
    }),
  "source.edit.abort": (client, input) =>
    client.request(
      "POST",
      `/api/v1/source-edits/${encodeURIComponent(requirePositional(input, 0, "source edit abort requires a session ID."))}/abort`,
      {},
    ),
  "source.edit.status": (client, input) =>
    client.request(
      "GET",
      `/api/v1/source-edits/${encodeURIComponent(requirePositional(input, 0, "source edit status requires a session ID."))}`,
    ),
  "source.edit.commit": async (client, input) =>
    client.request(
      "POST",
      `/api/v1/source-edits/${encodeURIComponent(requirePositional(input, 0, "source edit commit requires a session ID."))}/commit`,
      {
        content: await readFile(
          requirePositional(input, 1, "source edit commit requires an input file."),
          "utf8",
        ),
      },
    ),
};

const parseCli = async (argv: readonly string[]): Promise<ParsedCli> => {
  let baseUrl = process.env.CHAI_STUDIO_URL ?? null;
  let token = process.env.CHAI_STUDIO_BRIDGE_TOKEN ?? null;
  let runtimeDirectory = process.env.CHAI_STUDIO_RUNTIME_DIRECTORY ?? null;
  let instanceId: string | null = null;
  const commandTokens: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--url") {
      baseUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--token") {
      token = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--runtime-directory") {
      runtimeDirectory = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--instance") {
      instanceId = argv[index + 1] ?? null;
      index += 1;
    } else if (value !== undefined) {
      commandTokens.push(value);
    }
  }
  if (baseUrl === null) {
    const attachment = await discoverBridgeAttachment({
      ...(runtimeDirectory === null ? {} : { runtimeDirectory }),
      ...(instanceId === null ? {} : { instanceId }),
    });
    baseUrl = attachment.apiOrigin;
    token ??= attachment.token;
  }
  const client = new BridgeApiClient({ baseUrl, token });
  if (commandTokens.length === 0 || commandTokens[0] === "help" || commandTokens[0] === "commands") {
    return { client, command: null, input: { positional: [], options: new Map() } };
  }
  const descriptor = [...bridgeCommandCatalog]
    .sort((left, right) => right.path.length - left.path.length)
    .find((candidate) => candidate.path.every((value, index) => commandTokens[index] === value));
  if (descriptor === undefined) {
    throw new Error(`Unknown bridge command: ${commandTokens.join(" ")}. Run commands for discovery.`);
  }
  return {
    client,
    command: descriptor.name,
    input: parseCommandInput(commandTokens.slice(descriptor.path.length)),
  };
};

const parseCommandInput = (values: readonly string[]): CommandInput => {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals > 2) {
      options.set(value.slice(2, equals), value.slice(equals + 1));
      continue;
    }
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(value.slice(2), next);
      index += 1;
    } else {
      options.set(value.slice(2), true);
    }
  }
  return { positional, options };
};

const previewTransport = (client: BridgeApiClient, action: "play" | "pause" | "stop"): Promise<unknown> =>
  previewControl(client, "/api/v1/preview/sessions/current/transport", { action });

const previewControl = async (
  client: BridgeApiClient,
  pathname: string,
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  const status = record(await client.request("GET", "/api/v1/preview/sessions/current"), "preview");
  const state = recordField(status, "state");
  return client.request("POST", pathname, {
    ...body,
    expectedStateVersion: integerField(state, "stateVersion"),
  });
};

async function captureCurrent(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  let preview = await ensurePreview(client);
  const requestedFrame = option(input, "frame");
  if (requestedFrame !== null) {
    preview = record(
      await previewControl(client, "/api/v1/preview/sessions/current/seek", {
        frame: frame(requestedFrame),
      }),
      "preview seek",
    );
  }
  const previewState = recordField(preview, "state");
  const targetFrame = stringField(previewState, "currentFrame");
  const renderInput = inputWithOptions({ profile: "profile-still-png", frame: targetFrame });
  const started = await startRender(client, renderInput, `Codex frame ${targetFrame} capture`);
  const completed = record(await waitForJob(client, started.jobId, timeout(input)), "capture render job");
  const output = recordField(completed, "result");
  const outputId = stringField(output, "id");
  const activationRevisionId = stringField(output, "activationRevisionId");
  const synchronized = await waitForPreview(client, activationRevisionId, targetFrame, timeout(input));
  const synchronizedState = recordField(synchronized, "state");
  return client.request("POST", "/api/v1/captures/from-render", {
    label: option(input, "label") ?? `Codex exact frame ${targetFrame}`,
    outputId,
    expectedPreviewStateVersion: integerField(synchronizedState, "stateVersion"),
  });
}

async function captureRange(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const startFrame = frame(requirePositional(input, 0, "capture range requires a start frame."));
  const endFrameExclusive = frame(requirePositional(input, 1, "capture range requires an end frame."));
  if (BigInt(endFrameExclusive) <= BigInt(startFrame)) {
    throw new Error("Capture range end must be greater than start.");
  }
  const started = await startRender(
    client,
    inputWithOptions({
      profile: option(input, "profile") ?? "profile-review-proxy",
      range: `${startFrame}:${endFrameExclusive}`,
    }),
    `Codex range ${startFrame}-${endFrameExclusive}`,
  );
  const job = await waitForJob(client, started.jobId, timeout(input));
  return { kind: "immutable-range-render", startFrame, endFrameExclusive, job };
}

const startRender = async (
  client: BridgeApiClient,
  input: CommandInput,
  forcedName?: string,
): Promise<Readonly<{ jobId: string; value: unknown }>> => {
  const snapshot = await currentSnapshot(client);
  const { profile, scope } = await resolveRender(client, input);
  const preflight = record(
    await client.request("POST", "/api/v1/renders/preflight", {
      profile,
      scope,
      expectedRevisionId: snapshot.revisionId,
    }),
    "render preflight",
  );
  if (preflight.executable !== true) {
    throw new Error(`Render preflight is not executable: ${JSON.stringify(preflight.findings)}`);
  }
  const value = await client.request("POST", "/api/v1/renders", {
    profile,
    scope,
    name: forcedName ?? option(input, "name") ?? "Codex render",
    priority: safeInteger(option(input, "priority") ?? "0", "render priority"),
    actor,
    expectedRevisionId: snapshot.revisionId,
  });
  const jobId = stringField(recordField(record(value, "render start"), "job"), "id");
  return { jobId, value };
};

const renderPreflight = async (
  client: BridgeApiClient,
  input: CommandInput,
  expectedRevisionId: string,
): Promise<unknown> => {
  const { profile, scope } = await resolveRender(client, input);
  return client.request("POST", "/api/v1/renders/preflight", { profile, scope, expectedRevisionId });
};

async function uploadAsset(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const sourcePath = requirePositional(input, 0, "asset upload requires a local file.");
  const snapshot = await currentSnapshot(client);
  const id = option(input, "id") ?? `asset-${randomUUID()}`;
  return client.upload("/api/v1/assets/upload", sourcePath, {
    "x-chai-file-name": encodeURIComponent(path.basename(sourcePath)),
    "x-chai-asset-id": id,
    "x-chai-asset-kind": requiredOption(input, "kind"),
    "x-chai-asset-rights": requiredOption(input, "rights"),
    "x-chai-base-revision-id": snapshot.revisionId,
    "x-chai-idempotency-id": `idempotency-bridge-${randomUUID()}`,
    "x-chai-actor-id": actor.id,
    "x-chai-actor-kind": actor.kind,
    "x-chai-actor-session-id": actor.sessionId,
  });
}

async function importAsset(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const snapshot = await currentSnapshot(client);
  return client.request("POST", "/api/v1/assets/import", {
    sourcePath: requirePositional(input, 0, "asset import requires a source path."),
    id: option(input, "id") ?? `asset-${randomUUID()}`,
    kind: requiredOption(input, "kind"),
    rights: requiredOption(input, "rights"),
    context: mutationContext(snapshot.revisionId),
  });
}

async function searchAssets(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const kind = option(input, "kind");
  const rights = option(input, "rights");
  return client.request("POST", "/api/v1/assets/search", {
    query: {
      ...(input.positional[0] === undefined ? {} : { text: input.positional[0] }),
      ...(kind === null ? {} : { kinds: kind.split(",") }),
      ...(rights === null ? {} : { rights: rights.split(",") }),
      sortBy: option(input, "sort") ?? "name",
      direction: option(input, "direction") ?? "ascending",
      offset: safeInteger(option(input, "offset") ?? "0", "asset search offset"),
      limit: safeInteger(option(input, "limit") ?? "100", "asset search limit"),
    },
  });
}

async function assetJob(
  client: BridgeApiClient,
  input: CommandInput,
  action: "inspect" | "proxy-default",
): Promise<unknown> {
  const value = await client.request(
    "POST",
    `/api/v1/assets/${encodeURIComponent(requireAssetId(input))}/${action}`,
    {},
  );
  const jobId = stringField(record(value, `asset ${action}`), "id");
  return hasFlag(input, "wait") ? waitForJob(client, jobId, timeout(input)) : value;
}

async function mutateAsset(
  client: BridgeApiClient,
  input: CommandInput,
  action: "relink" | "replace",
): Promise<unknown> {
  const snapshot = await currentSnapshot(client);
  const assetId = requireAssetId(input);
  const sourcePath = requirePositional(input, 1, `asset ${action} requires a source path.`);
  return client.request("POST", `/api/v1/assets/${encodeURIComponent(assetId)}/${action}`, {
    sourcePath,
    ...(action === "replace"
      ? {
          expectedContentHash: requiredOption(input, "hash"),
          kind: requiredOption(input, "kind"),
          rights: requiredOption(input, "rights"),
        }
      : {}),
    context: mutationContext(snapshot.revisionId),
  });
}

async function updateAssetRights(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const snapshot = await currentSnapshot(client);
  const value = await jsonValueInput(requirePositional(input, 0, "asset rights requires a JSON file."));
  const records = Array.isArray(value)
    ? value
    : Array.isArray(record(value, "asset rights input").records)
      ? record(value, "asset rights input").records
      : null;
  if (!Array.isArray(records)) throw new Error("Asset rights JSON must be an array or contain records.");
  return client.request("POST", "/api/v1/assets/rights", {
    records,
    context: mutationContext(snapshot.revisionId),
  });
}

const mutationContext = (baseRevisionId: string): Readonly<Record<string, unknown>> => ({
  baseRevisionId,
  idempotencyId: `idempotency-bridge-${randomUUID()}`,
  actor,
});

const resolveRender = async (
  client: BridgeApiClient,
  input: CommandInput,
): Promise<
  Readonly<{ profile: Readonly<Record<string, unknown>>; scope: Readonly<Record<string, string>> }>
> => {
  const profileId = option(input, "profile");
  if (profileId === null) throw new Error("Render command requires --profile <profile-id>.");
  const profiles = array(await client.request("GET", "/api/v1/renders/profiles"), "render profiles");
  const profile = profiles
    .map((value) => record(value, "render profile"))
    .find((value) => value.id === profileId || value.name === profileId);
  if (profile === undefined) throw new Error(`Unknown render profile: ${profileId}.`);
  const frameValue = option(input, "frame");
  const rangeValue = option(input, "range");
  if (frameValue !== null && rangeValue !== null) throw new Error("Choose either --frame or --range.");
  if (frameValue !== null) return { profile, scope: { kind: "frame", frame: frame(frameValue) } };
  if (rangeValue !== null) {
    const match = /^(\d+):(\d+)$/.exec(rangeValue);
    if (match === null) throw new Error("Render range must use <start:endExclusive>.");
    const startFrame = frame(match[1] ?? "");
    const endFrameExclusive = frame(match[2] ?? "");
    if (BigInt(endFrameExclusive) <= BigInt(startFrame)) {
      throw new Error("Render range end must be greater than start.");
    }
    return { profile, scope: { kind: "in-out", startFrame, endFrameExclusive } };
  }
  return { profile, scope: { kind: "full-timeline" } };
};

async function qaRun(client: BridgeApiClient, input: CommandInput): Promise<unknown> {
  const outputId = input.positional[0] ?? (await latestOutput(client)).id;
  const snapshot = await currentSnapshot(client);
  const value = await client.request("POST", `/api/v1/renders/outputs/${encodeURIComponent(outputId)}/qa`, {
    actor,
    expectedRevisionId: snapshot.revisionId,
  });
  const jobId = stringField(record(value, "qa run"), "id");
  return hasFlag(input, "wait") ? waitForJob(client, jobId, timeout(input)) : value;
}

const latestOutput = async (
  client: BridgeApiClient,
): Promise<Readonly<{ id: string; createdAt: string }>> => {
  const values = array(await client.request("GET", "/api/v1/renders/outputs"), "render outputs");
  const outputs = values.map((value) => {
    const output = record(value, "render output");
    return { id: stringField(output, "id"), createdAt: stringField(output, "createdAt") };
  });
  const latest = outputs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latest === undefined) throw new Error("No render output exists.");
  return latest;
};

const executeCommandFile = async (
  client: BridgeApiClient,
  input: CommandInput,
  validationOnly: boolean,
): Promise<unknown> => {
  const path = requirePositional(input, 0, "command requires a JSON file path or - for stdin.");
  const envelope = await jsonInput(path);
  return client.request("POST", "/api/v1/commands", { ...envelope, validationOnly });
};

const jsonInput = async (inputPath: string): Promise<Readonly<Record<string, unknown>>> => {
  return record(await jsonValueInput(inputPath), "JSON input");
};

const jsonValueInput = async (inputPath: string): Promise<unknown> => {
  const contents = inputPath === "-" ? await readStandardInput() : await readFile(inputPath, "utf8");
  return JSON.parse(contents) as unknown;
};

const currentSnapshot = async (
  client: BridgeApiClient,
): Promise<Readonly<{ revisionId: string; projectId: string }>> => {
  const snapshot = record(
    await client.request("GET", "/api/v1/projects/current/snapshot"),
    "project snapshot",
  );
  return {
    revisionId: stringField(recordField(snapshot, "pointer"), "revisionId"),
    projectId: stringField(recordField(snapshot, "project"), "projectId"),
  };
};

const ensurePreview = async (client: BridgeApiClient): Promise<Readonly<Record<string, unknown>>> => {
  try {
    return record(await client.request("GET", "/api/v1/preview/sessions/current"), "preview");
  } catch {
    return record(await client.request("POST", "/api/v1/preview/sessions/load", {}), "preview");
  }
};

const waitForJob = async (client: BridgeApiClient, jobId: string, timeoutMs: number): Promise<unknown> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = record(await client.request("GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`), "job");
    const status = stringField(job, "status");
    if (status === "completed") return job;
    if (status === "failed" || status === "cancelled") {
      const detail =
        typeof job.error === "string"
          ? job.error
          : job.error === null || job.error === undefined
            ? "no error detail"
            : JSON.stringify(job.error);
      throw new Error(`Job ${jobId} ${status}: ${detail}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for job ${jobId}.`);
    await delay(200);
  }
};

const waitForPreview = async (
  client: BridgeApiClient,
  revisionId: string,
  currentFrame: string,
  timeoutMs: number,
): Promise<Readonly<Record<string, unknown>>> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = record(
      await client.request("GET", "/api/v1/preview/sessions/current"),
      "preview synchronization",
    );
    const state = recordField(status, "state");
    if (
      status.synchronized === true &&
      state.revisionId === revisionId &&
      state.currentFrame === currentFrame
    ) {
      return status;
    }
    if (Date.now() >= deadline) throw new Error("Timed out waiting for preview synchronization.");
    await delay(100);
  }
};

const inputWithOptions = (values: Readonly<Record<string, string>>): CommandInput => ({
  positional: [],
  options: new Map(Object.entries(values)),
});

const requireJobId = (input: CommandInput): string =>
  requirePositional(input, 0, "Command requires a job ID.");
const requireOutputId = (input: CommandInput): string =>
  requirePositional(input, 0, "Command requires an output ID.");
const requireAssetId = (input: CommandInput): string =>
  requirePositional(input, 0, "Command requires an asset ID.");

const requirePositional = (input: CommandInput, index: number, message: string): string => {
  const value = input.positional[index];
  if (value === undefined || value.length === 0) throw new Error(message);
  return value;
};

const option = (input: CommandInput, name: string): string | null => {
  const value = input.options.get(name);
  if (value === undefined) return null;
  if (value === true) throw new Error(`--${name} requires a value.`);
  return value;
};

const requiredOption = (input: CommandInput, name: string): string => {
  const value = option(input, name);
  if (value === null) throw new Error(`--${name} is required.`);
  return value;
};

const hasFlag = (input: CommandInput, name: string): boolean => input.options.get(name) === true;
const timeout = (input: CommandInput): number =>
  safeInteger(option(input, "timeout-ms") ?? "120000", "timeout-ms");

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array.`);
  return value;
};

const recordField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> => record(value[key], key);

const stringField = (value: Readonly<Record<string, unknown>>, key: string): string => {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`${key} is not a string.`);
  return field;
};

const integerField = (value: Readonly<Record<string, unknown>>, key: string): number => {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) throw new Error(`${key} is not an integer.`);
  return field;
};

const safeInteger = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer.`);
  return parsed;
};

const boundedNumber = (value: string, label: string, minimum: number, maximum: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
  }
  return parsed;
};

const assertSafeReviewOperation = (operation: Readonly<Record<string, unknown>>): void => {
  const kind = operation.kind;
  const allowed = new Set([
    "review.bundle.create",
    "review.bundle.delete",
    "review.issue.create",
    "review.issue.transition",
    "review.comparison.create",
    "review.request.create",
    "review.take.add",
    "review.take.activate",
  ]);
  if (typeof kind !== "string" || !allowed.has(kind)) {
    throw new Error("Bridge review operations cannot record owner decisions or accepted exceptions.");
  }
  if (
    kind === "review.issue.transition" &&
    record(operation.transition, "review transition").to === "accepted-exception"
  ) {
    throw new Error("Bridge review operations cannot accept exceptions on the owner's behalf.");
  }
};

const frame = (value: string): string => {
  if (!/^\d+$/.test(value)) throw new Error("Frame must be a non-negative integer string.");
  return BigInt(value).toString(10);
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const readStandardInput = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
  }
  return Buffer.concat(chunks).toString("utf8");
};

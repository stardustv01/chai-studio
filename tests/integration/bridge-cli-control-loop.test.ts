import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStudioServer, type StartedStudioServer } from "../../apps/studio-server/src/index.js";

const executeFile = promisify(execFile);
const roots: string[] = [];
const servers: StartedStudioServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public Codex bridge CLI", () => {
  it("discovers a private attachment and completes render, exact capture, QA, and receipt operations", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-bridge-cli-"));
    roots.push(parent);
    const runtimeDirectory = path.join(parent, "runtime");
    const server = await startStudioServer({ preferredPort: 0, runtimeDirectory });
    servers.push(server);
    const projectRoot = path.join(parent, "Codex Operated.chai");

    const attachmentDirectory = (await readdir(runtimeDirectory)).find((name) => name.endsWith(".lock"));
    expect(attachmentDirectory).toBeDefined();
    const attachmentPath = path.join(runtimeDirectory, attachmentDirectory ?? "", "bridge-session.json");
    expect((await stat(attachmentPath)).mode & 0o077).toBe(0);
    const attachment = JSON.parse(await readFile(attachmentPath, "utf8")) as {
      readonly token: string;
      readonly capabilities: readonly string[];
    };
    expect(attachment.token).not.toBe(server.sessionToken);
    expect(attachment.capabilities).toContain("render.control");
    expect(attachment.capabilities).not.toContain("approval.write");

    const create = await cli(runtimeDirectory, [
      "project",
      "create",
      projectRoot,
      "Codex Operated",
      "--starter",
      "showcase",
    ]);
    expect(create).toMatchObject({ rootPath: projectRoot });
    expect(await cli(runtimeDirectory, ["project", "snapshot"])).toMatchObject({
      project: { title: "Codex Operated" },
    });

    const uploadPath = path.join(parent, "bridge-image.png");
    await writeFile(
      uploadPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4w8AARAwQCgAfjgPxzzTeXgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const uploaded = await cli(runtimeDirectory, [
      "asset",
      "upload",
      uploadPath,
      "--id",
      "asset-bridge-image",
      "--kind",
      "image",
      "--rights",
      "owned",
    ]);
    expect(uploaded).toMatchObject({
      asset: { id: "asset-bridge-image", kind: "image", rights: "owned" },
      receipt: { actorId: "codex-bridge", status: "committed" },
    });
    expect(await cli(runtimeDirectory, ["asset", "search", "bridge-image"])).toMatchObject({
      total: 1,
      entries: [{ id: "asset-bridge-image" }],
    });
    expect(await cli(runtimeDirectory, ["asset", "inspect", "asset-bridge-image", "--wait"])).toMatchObject({
      status: "completed",
      kind: "asset.inspect",
    });

    const capture = await cli(runtimeDirectory, [
      "capture",
      "current",
      "--label",
      "Black-box exact capture",
      "--timeout-ms",
      "120000",
    ]);
    expect(capture).toMatchObject({
      label: "Black-box exact capture",
      truthMode: "rendered-fidelity",
      quality: "full",
    });
    expect((capture as { readonly renderOutputId?: string }).renderOutputId).toMatch(/^output-/u);

    const snapshot = (await cli(runtimeDirectory, ["project", "snapshot"])) as {
      readonly timeline: { readonly timelineId: string };
    };
    const annotationPath = path.join(parent, "annotation.json");
    await writeFile(
      annotationPath,
      JSON.stringify({
        entityIds: [snapshot.timeline.timelineId],
        frame: null,
        captureId: (capture as { readonly id: string }).id,
        body: "Codex-authored verification note",
        severity: "warning",
      }),
    );
    expect(await cli(runtimeDirectory, ["annotation", "create", annotationPath])).toMatchObject({
      body: "Codex-authored verification note",
      author: { kind: "codex" },
    });
    expect(await cli(runtimeDirectory, ["annotation", "list"])).toHaveLength(1);
    const reviewWorkspace = (await cli(runtimeDirectory, ["review", "workspace"])) as {
      readonly projectId: string;
    };
    expect(reviewWorkspace.projectId).toMatch(/^project-/u);

    const outputs = (await cli(runtimeDirectory, ["render", "outputs"])) as readonly {
      readonly id: string;
      readonly profile: { readonly id: string };
    }[];
    const still = outputs.find((output) => output.profile.id === "profile-still-png");
    expect(still?.id).toMatch(/^output-/u);
    if (still === undefined) throw new Error("Exact still output was not published.");

    const receipt = await cli(runtimeDirectory, ["receipt", "get", still.id]);
    expect(receipt).toMatchObject({ base: { outputId: still.id } });
    const qaJob = await cli(runtimeDirectory, ["qa", "run", still.id, "--wait", "--timeout-ms", "120000"]);
    expect(qaJob).toMatchObject({ status: "completed", kind: "render.qa" });
    const qa = await cli(runtimeDirectory, ["qa", "get", still.id]);
    expect(qa).toMatchObject({ outputId: still.id, latest: { state: "qa_passed" } });

    const apiOrigin = server.report.origins[0];
    if (apiOrigin === undefined) throw new Error("Studio API origin is unavailable.");
    const forbidden = await fetch(`${apiOrigin}/api/v1/renders/outputs/${still.id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${attachment.token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toContain("bridge-capability-forbidden");
  }, 180_000);
});

const cli = async (runtimeDirectory: string, arguments_: readonly string[]): Promise<unknown> => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CHAI_STUDIO_RUNTIME_DIRECTORY: runtimeDirectory,
  };
  delete environment.CHAI_STUDIO_URL;
  delete environment.CHAI_STUDIO_BRIDGE_TOKEN;
  const result = await executeFile(process.execPath, ["scripts/chai-studio.mjs", ...arguments_], {
    cwd: path.resolve("."),
    env: environment,
    timeout: 150_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(result.stdout) as unknown;
};

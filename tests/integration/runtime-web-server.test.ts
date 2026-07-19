import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startRuntimeWebServer } from "../../scripts/runtime-web-server.mjs";

const roots: string[] = [];
const servers: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release runtime web server", () => {
  it("serves the compiled app with a private authenticated bootstrap and strict headers", async () => {
    const root = await fixture();
    const token = "release_runtime_token_1234567890";
    const server = await startRuntimeWebServer({
      webRoot: root,
      session: { token, serverOrigin: "http://127.0.0.1:4317" },
      port: 0,
    });
    servers.push(server);

    const index = await fetch(server.origin);
    const html = await index.text();
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toContain("no-store");
    expect(index.headers.get("content-security-policy")).toContain(
      "connect-src 'self' http://127.0.0.1:4317",
    );
    expect(html).toContain("__CHAI_STUDIO_SESSION__");
    expect(html).toContain(token);
    expect(server.origin).not.toContain(token);

    const asset = await fetch(`${server.origin}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toBe("export const ready = true;\n");
  });

  it("rejects traversal, missing files, and non-read methods", async () => {
    const root = await fixture();
    const server = await startRuntimeWebServer({
      webRoot: root,
      session: {
        token: "release_runtime_token_1234567890",
        serverOrigin: "http://127.0.0.1:4317",
      },
      port: 0,
    });
    servers.push(server);

    expect((await fetch(`${server.origin}/%2e%2e%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${server.origin}/missing.js`)).status).toBe(404);
    expect((await fetch(server.origin, { method: "POST" })).status).toBe(405);
  });
});

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-runtime-web-"));
  roots.push(root);
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "index.html"),
    "<!doctype html><html><head></head><body>Studio</body></html>\n",
  );
  await writeFile(path.join(root, "assets", "app.js"), "export const ready = true;\n");
  return root;
};

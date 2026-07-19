import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, PreviewServer } from "vite";

export interface StudioBrowserSessionBootstrap {
  readonly token: string;
  readonly serverOrigin: string;
}

export const studioSessionBootstrapScript = (session: StudioBrowserSessionBootstrap): string => {
  assertSessionBootstrap(session);
  const serialized = JSON.stringify(session).replaceAll("<", "\\u003c");
  return `Object.defineProperty(window,"__CHAI_STUDIO_SESSION__",{configurable:false,enumerable:false,writable:false,value:Object.freeze(${serialized})});`;
};

export const runtimeSessionBootstrapPlugin = (): Plugin => ({
  name: "chai-studio-runtime-session-bootstrap",
  apply: "serve",
  configurePreviewServer(server) {
    const token = process.env.CHAI_STUDIO_SESSION_TOKEN;
    const serverOrigin = process.env.CHAI_STUDIO_SERVER_ORIGIN;
    if (token === undefined || serverOrigin === undefined) return;
    const session = { token, serverOrigin };
    assertSessionBootstrap(session);
    installIndexMiddleware(server, session);
  },
});

const installIndexMiddleware = (server: PreviewServer, session: StudioBrowserSessionBootstrap): void => {
  server.middlewares.use((request, response, next) => {
    void serveIndex(request.url, response, next, server, session);
  });
};

const serveIndex = async (
  requestUrl: string | undefined,
  response: ServerResponse,
  next: (error?: Error) => void,
  server: PreviewServer,
  session: StudioBrowserSessionBootstrap,
): Promise<void> => {
  try {
    const pathname = new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/" && pathname !== "/index.html") {
      next();
      return;
    }
    const outputDirectory = path.resolve(server.config.root, server.config.build.outDir);
    const source = await readFile(path.join(outputDirectory, "index.html"), "utf8");
    const bootstrap = studioSessionBootstrapScript(session);
    const html = source.replace("<head>", `<head>\n    <script>${bootstrap}</script>`);
    const scriptHash = createHash("sha256").update(bootstrap).digest("base64");
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store, max-age=0");
    response.setHeader("pragma", "no-cache");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cross-origin-opener-policy", "same-origin");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader(
      "content-security-policy",
      [
        "default-src 'self'",
        `script-src 'self' 'sha256-${scriptHash}'`,
        `connect-src 'self' ${session.serverOrigin}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    response.end(html);
  } catch (error) {
    next(error instanceof Error ? error : new Error("Studio session bootstrap failed."));
  }
};

const assertSessionBootstrap = (session: StudioBrowserSessionBootstrap): void => {
  if (!/^[A-Za-z0-9_-]{20,256}$/u.test(session.token)) {
    throw new Error("Studio browser session token is missing or malformed.");
  }
  let origin: URL;
  try {
    origin = new URL(session.serverOrigin);
  } catch {
    throw new Error("Studio server origin is invalid.");
  }
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.port === ""
  ) {
    throw new Error("Studio server origin must be an exact loopback HTTP origin with a port.");
  }
};

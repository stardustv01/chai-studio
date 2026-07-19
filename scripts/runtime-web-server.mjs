import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { URL } from "node:url";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export const studioSessionBootstrapScript = (session) => {
  assertSessionBootstrap(session);
  const serialized = JSON.stringify(session).replaceAll("<", "\\u003c");
  return `Object.defineProperty(window,"__CHAI_STUDIO_SESSION__",{configurable:false,enumerable:false,writable:false,value:Object.freeze(${serialized})});`;
};

export const startRuntimeWebServer = async ({ webRoot, session, host = "127.0.0.1", port = 4173 }) => {
  assertSessionBootstrap(session);
  const resolvedRoot = path.resolve(webRoot);
  const indexSource = await readFile(path.join(resolvedRoot, "index.html"), "utf8");
  const bootstrap = studioSessionBootstrapScript(session);
  const indexHtml = indexSource.replace("<head>", `<head>\n    <script>${bootstrap}</script>`);
  if (indexHtml === indexSource) throw new Error("Studio web index is missing its head element.");

  const server = createServer((request, response) => {
    void serveRequest({ request, response, resolvedRoot, indexHtml, bootstrap, session });
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Studio web server did not bind to a TCP port.");
  }
  return {
    origin: `http://${host}:${String(address.port)}`,
    close: () => closeServer(server),
  };
};

const serveRequest = async ({ request, response, resolvedRoot, indexHtml, bootstrap, session }) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      respond(response, 405, "Method Not Allowed", { allow: "GET, HEAD" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "/index.html") {
      setSecurityHeaders(response, bootstrap, session);
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.setHeader("cache-control", "no-store, max-age=0");
      if (request.method === "HEAD") response.end();
      else response.end(indexHtml);
      return;
    }

    const file = path.resolve(resolvedRoot, `.${pathname}`);
    if (!isInside(resolvedRoot, file)) {
      respond(response, 404, "Not Found");
      return;
    }
    const metadata = await stat(file).catch(() => null);
    if (metadata === null || !metadata.isFile()) {
      respond(response, 404, "Not Found");
      return;
    }
    setSecurityHeaders(response, bootstrap, session);
    response.statusCode = 200;
    response.setHeader(
      "content-type",
      contentTypes.get(path.extname(file).toLowerCase()) ?? "application/octet-stream",
    );
    response.setHeader("content-length", String(metadata.size));
    response.setHeader(
      "cache-control",
      pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    );
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file)
      .on("error", () => respond(response, 500, "Internal Server Error"))
      .pipe(response);
  } catch {
    if (!response.headersSent) respond(response, 400, "Bad Request");
    else response.end();
  }
};

const setSecurityHeaders = (response, bootstrap, session) => {
  const scriptHash = createHash("sha256").update(bootstrap).digest("base64");
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
};

const respond = (response, statusCode, message, headers = {}) => {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(`${message}\n`);
};

const assertSessionBootstrap = (session) => {
  if (!/^[A-Za-z0-9_-]{20,256}$/u.test(session?.token ?? "")) {
    throw new Error("Studio browser session token is missing or malformed.");
  }
  let origin;
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

const isInside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
    server.closeAllConnections?.();
  });

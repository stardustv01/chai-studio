import { describe, expect, it } from "vitest";
import { StaleRevisionError, StudioApiClient } from "../../apps/studio-web/src/api-client.js";
import type { StudioFetcher } from "../../apps/studio-web/src/api-client.js";

const correlationId = "123e4567-e89b-42d3-a456-426614174000";

describe("Studio web API client", () => {
  it("uses a public health request and validates the success envelope", async () => {
    let requestInput: RequestInfo | URL | null = null;
    let requestInit: RequestInit | undefined;
    const fetcher: StudioFetcher = (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        Response.json({
          apiVersion: "2026-07-15",
          ok: true,
          correlationId,
          data: { contractVersion: "2026-07-15" },
        }),
      );
    };
    const client = new StudioApiClient({ fetcher, correlationId: () => correlationId });
    await expect(client.health()).resolves.toEqual({ contractVersion: "2026-07-15" });
    expect(requestInput).toBe("/api/health");
    expect(new Headers(requestInit?.headers).get("x-correlation-id")).toBe(correlationId);
    expect(new Headers(requestInit?.headers).has("authorization")).toBe(false);
  });

  it("never silently sends protected requests without the local session token", async () => {
    const client = new StudioApiClient({
      fetcher: () => Promise.reject(new Error("Fetcher must not run without authentication.")),
      correlationId: () => correlationId,
    });
    await expect(client.session()).rejects.toMatchObject({
      diagnostic: { code: "client.session-token-missing" },
    });
  });

  it("fails closed on invalid JSON and malformed success or error envelopes", async () => {
    const clientFor = (response: Response) =>
      new StudioApiClient({
        fetcher: () => Promise.resolve(response),
        correlationId: () => correlationId,
      });
    await expect(
      clientFor(new Response("not-json", { headers: { "content-type": "application/json" } })).health(),
    ).rejects.toMatchObject({ diagnostic: { code: "client.api-envelope-invalid" } });
    await expect(
      clientFor(Response.json({ apiVersion: "2026-07-15", ok: true, correlationId })).health(),
    ).rejects.toMatchObject({ diagnostic: { code: "client.api-envelope-invalid" } });
    await expect(
      clientFor(
        Response.json({ apiVersion: "2026-07-15", ok: false, correlationId, error: { code: "broken" } }),
      ).health(),
    ).rejects.toMatchObject({ diagnostic: { code: "client.api-envelope-invalid" } });
  });

  it("classifies stale revision responses for mandatory resync", async () => {
    const fetcher: StudioFetcher = () =>
      Promise.resolve(
        Response.json(
          {
            apiVersion: "2026-07-15",
            ok: false,
            correlationId,
            error: {
              category: "conflict",
              code: "project.revision-conflict",
              stage: "command",
              entityId: "revision-000428",
              retryable: true,
              message: "The base revision is stale.",
              repairHint: "Resync and review the latest revision.",
              details: null,
            },
          },
          { status: 409 },
        ),
      );
    const client = new StudioApiClient({
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });
    await expect(client.command("/api/v1/commands", {}, "revision-000427")).rejects.toBeInstanceOf(
      StaleRevisionError,
    );
  });

  it("sends authenticated preview controls through the bounded preview endpoint", async () => {
    let requestInput: RequestInfo | URL | null = null;
    let requestInit: RequestInit | undefined;
    const fetcher: StudioFetcher = (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        Response.json({
          apiVersion: "2026-07-15",
          ok: true,
          correlationId,
          data: { state: { currentFrame: "445", stateVersion: 2 } },
        }),
      );
    };
    const client = new StudioApiClient({
      baseUrl: "http://127.0.0.1:44317",
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });
    await client.previewControl("step", { delta: 1, expectedStateVersion: 1 });
    expect(requestInput).toBe("http://127.0.0.1:44317/api/v1/preview/sessions/current/step");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe('{"delta":1,"expectedStateVersion":1}');
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer local-session-token-value-0001",
    );
    expect(() => client.previewControl("../unsafe", {})).toThrow(/endpoint is invalid/);
  });

  it("opens, creates, and lists local projects through authenticated project authority", async () => {
    const requests: { readonly input: string; readonly init: RequestInit | undefined }[] = [];
    const fetcher: StudioFetcher = (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ input: requestUrl, init });
      return Promise.resolve(
        Response.json({
          apiVersion: "2026-07-15",
          ok: true,
          correlationId,
          data: requestUrl.endsWith("/recent") ? [] : { rootPath: "/tmp/Owner Film.chai" },
        }),
      );
    };
    const client = new StudioApiClient({
      baseUrl: "http://127.0.0.1:44317",
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });

    await client.recentProjects();
    await client.openProject("/tmp/Owner Film.chai");
    await client.createProject({
      targetPath: "/tmp/New Film.chai",
      title: "New Film",
      starter: "empty",
    });

    expect(requests.map((request) => request.input)).toEqual([
      "http://127.0.0.1:44317/api/v1/projects/recent",
      "http://127.0.0.1:44317/api/v1/projects/open",
      "http://127.0.0.1:44317/api/v1/projects/create",
    ]);
    expect(requests[1]?.init?.body).toBe('{"rootPath":"/tmp/Owner Film.chai"}');
    expect(requests[2]?.init?.body).toBe(
      '{"targetPath":"/tmp/New Film.chai","title":"New Film","starter":"empty"}',
    );
    expect(new Headers(requests[1]?.init?.headers).get("x-chai-csrf-token")).toBe(
      "local-session-token-value-0001",
    );
  });

  it("streams uploaded files without replacing their binary content type", async () => {
    let requestInput: RequestInfo | URL | null = null;
    let requestInit: RequestInit | undefined;
    const fetcher: StudioFetcher = (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        Response.json(
          {
            apiVersion: "2026-07-15",
            ok: true,
            correlationId,
            data: {
              asset: { id: "asset-upload-0001" },
              receipt: { status: "committed", resultingRevisionId: "revision-upload-0002" },
              storedPath: "assets/imported/asset-upload-0001-source.mov",
              bytesWritten: 5,
            },
          },
          { status: 201 },
        ),
      );
    };
    const client = new StudioApiClient({
      baseUrl: "http://127.0.0.1:44317",
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });
    const file = new File(["media"], "source.mov", { type: "video/quicktime" });
    await client.uploadAsset({
      file,
      assetId: "asset-upload-0001",
      kind: "video",
      rights: "owned",
      baseRevisionId: "revision-upload-0001",
      idempotencyId: "idempotency-upload-0001",
    });
    const headers = new Headers(requestInit?.headers);
    expect(requestInput).toBe("http://127.0.0.1:44317/api/v1/assets/upload");
    expect(requestInit?.body).toBe(file);
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("x-chai-file-name")).toBe("source.mov");
    expect(headers.get("x-chai-asset-rights")).toBe("owned");
    expect(headers.get("authorization")).toBe("Bearer local-session-token-value-0001");
  });

  it("loads hash-verified decoded source frames without putting the session token in the URL", async () => {
    let requestInput: RequestInfo | URL | null = null;
    let requestInit: RequestInit | undefined;
    const fetcher: StudioFetcher = (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        new Response(new Blob(["decoded"], { type: "image/png" }), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-chai-artifact-sha256": "a".repeat(64),
            "x-chai-source-frame": "48",
          },
        }),
      );
    };
    const client = new StudioApiClient({
      baseUrl: "http://127.0.0.1:44317",
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });

    await expect(client.assetSourceFrame("asset-source-0001", "48")).resolves.toMatchObject({
      contentHash: "a".repeat(64),
      mediaType: "image/png",
      frame: "48",
    });
    expect(requestInput).toBe("http://127.0.0.1:44317/api/v1/assets/asset-source-0001/source-frame?frame=48");
    expect(String(requestInput)).not.toContain("local-session-token-value-0001");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer local-session-token-value-0001",
    );
  });

  it("accepts only revision-bound authenticated program frames", async () => {
    let requestInput: RequestInfo | URL | null = null;
    let requestInit: RequestInit | undefined;
    const fetcher: StudioFetcher = (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        new Response(new Blob(["program"], { type: "image/png" }), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-chai-artifact-sha256": "c".repeat(64),
            "x-chai-program-frame": "150",
            "x-chai-revision-id": "revision-program-0002",
          },
        }),
      );
    };
    const client = new StudioApiClient({
      baseUrl: "http://127.0.0.1:44317",
      sessionToken: "local-session-token-value-0001",
      fetcher,
      correlationId: () => correlationId,
    });

    await expect(client.programFrame("150", "revision-program-0002")).resolves.toMatchObject({
      contentHash: "c".repeat(64),
      frame: "150",
      revisionId: "revision-program-0002",
    });
    expect(requestInput).toBe("http://127.0.0.1:44317/api/v1/preview/program-frame?frame=150");
    expect(String(requestInput)).not.toContain("local-session-token-value-0001");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer local-session-token-value-0001",
    );
    await expect(client.programFrame("150", "revision-wrong-0003")).rejects.toThrow(
      "does not match the requested revision and frame",
    );
  });

  it("fails closed before accepting invalid or failed program-frame authority", async () => {
    const unauthenticated = new StudioApiClient({
      fetcher: () => Promise.reject(new Error("Fetcher must not run without authentication.")),
      correlationId: () => correlationId,
    });
    await expect(unauthenticated.programFrame("0", "revision-program-0002")).rejects.toMatchObject({
      diagnostic: { code: "client.session-token-missing" },
    });

    const invalid = new StudioApiClient({
      sessionToken: "local-session-token-value-0001",
      fetcher: () => Promise.reject(new Error("Fetcher must not run for invalid identity.")),
      correlationId: () => correlationId,
    });
    await expect(invalid.programFrame("01", "revision-program-0002")).rejects.toThrow(
      "Program frame identity is invalid",
    );
    await expect(invalid.programFrame("0", " ")).rejects.toThrow("Program frame identity is invalid");

    const failed = new StudioApiClient({
      sessionToken: "local-session-token-value-0001",
      fetcher: () =>
        Promise.resolve(
          Response.json(
            {
              apiVersion: "2026-07-15",
              ok: false,
              correlationId,
              error: {
                category: "preview",
                code: "preview.program-frame-unavailable",
                stage: "program-frame",
                entityId: null,
                retryable: true,
                message: "The exact program frame is unavailable.",
                repairHint: "Retry after the compositor is ready.",
                details: null,
              },
            },
            { status: 503 },
          ),
        ),
      correlationId: () => correlationId,
    });
    await expect(failed.programFrame("0", "revision-program-0002")).rejects.toMatchObject({
      diagnostic: { code: "preview.program-frame-unavailable" },
    });

    const unavailable = new StudioApiClient({
      sessionToken: "local-session-token-value-0001",
      fetcher: () => Promise.resolve(new Response("compositor offline", { status: 503 })),
      correlationId: () => correlationId,
    });
    await expect(unavailable.programFrame("0", "revision-program-0002")).rejects.toThrow(
      "could not composite the program frame",
    );
  });
});

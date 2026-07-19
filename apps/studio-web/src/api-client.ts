import type { StudioDiagnostic, StudioSnapshot } from "./types.js";

export interface ApiSuccessEnvelope<T> {
  readonly apiVersion: string;
  readonly ok: true;
  readonly correlationId: string;
  readonly data: T;
}

export interface ApiErrorEnvelope {
  readonly apiVersion: string;
  readonly ok: false;
  readonly correlationId: string;
  readonly error: Omit<StudioDiagnostic, "correlationId" | "detail"> & {
    readonly details: Readonly<Record<string, unknown>> | null;
  };
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
export type StudioFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface StudioApiClientOptions {
  readonly baseUrl?: string;
  readonly sessionToken?: string | null;
  readonly fetcher?: StudioFetcher;
  readonly correlationId?: () => string;
}

export interface StudioJobView {
  readonly id: string;
  readonly kind: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly progress: number;
  readonly stage: string;
  readonly error: string | null;
}

export class StudioApiError extends Error {
  readonly diagnostic: StudioDiagnostic;

  constructor(diagnostic: StudioDiagnostic) {
    super(diagnostic.message);
    this.name = "StudioApiError";
    this.diagnostic = diagnostic;
  }
}

export class StaleRevisionError extends StudioApiError {
  constructor(diagnostic: StudioDiagnostic) {
    super(diagnostic);
    this.name = "StaleRevisionError";
  }
}

export class StudioApiClient {
  readonly baseUrl: string;
  readonly sessionToken: string | null;
  readonly #fetcher: StudioFetcher;
  readonly #correlationId: () => string;

  constructor(options: StudioApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.sessionToken = options.sessionToken ?? null;
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#correlationId = options.correlationId ?? createCorrelationId;
  }

  health(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/health", { method: "GET", signal: signal ?? null }, false);
  }

  session(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/session", { method: "GET", signal: signal ?? null });
  }

  projectSnapshot(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/projects/current/snapshot", { method: "GET", signal: signal ?? null });
  }

  projectRevisions(signal?: AbortSignal): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return this.request("/api/v1/projects/current/revisions", { method: "GET", signal: signal ?? null });
  }

  recentProjects(signal?: AbortSignal): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return this.request("/api/v1/projects/recent", { method: "GET", signal: signal ?? null });
  }

  openProject(rootPath: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/projects/open", {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({ rootPath }),
    });
  }

  createProject(
    input: Readonly<{
      targetPath: string;
      title: string;
      starter: "empty" | "showcase" | "launch-film";
    }>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/projects/create", {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify(input),
    });
  }

  previewSnapshot(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/preview/sessions/current", { method: "GET", signal: signal ?? null });
  }

  async programFrame(
    frame: string,
    expectedRevisionId: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ blob: Blob; contentHash: string; frame: string; revisionId: string }>> {
    if (this.sessionToken === null) throw missingSessionTokenError(this.#correlationId());
    if (!/^(?:0|[1-9][0-9]{0,11})$/u.test(frame) || expectedRevisionId.trim().length === 0) {
      throw new Error("Program frame identity is invalid.");
    }
    const correlationId = this.#correlationId();
    const response = await this.#fetcher(
      `${this.baseUrl}/api/v1/preview/program-frame?frame=${encodeURIComponent(frame)}`,
      {
        method: "GET",
        signal: signal ?? null,
        headers: {
          accept: "image/png",
          authorization: `Bearer ${this.sessionToken}`,
          "x-correlation-id": correlationId,
        },
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (payload !== null && isApiEnvelope(payload) && !payload.ok) {
        throw new StudioApiError({
          ...payload.error,
          detail: payload.error.details,
          correlationId: payload.correlationId,
        });
      }
      throw protocolError(correlationId, "The Studio server could not composite the program frame.");
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
    const contentHash = response.headers.get("x-chai-artifact-sha256");
    const returnedFrame = response.headers.get("x-chai-program-frame");
    const revisionId = response.headers.get("x-chai-revision-id");
    if (
      mediaType !== "image/png" ||
      contentHash === null ||
      !/^[a-f0-9]{64}$/u.test(contentHash) ||
      returnedFrame !== frame ||
      revisionId !== expectedRevisionId
    ) {
      throw protocolError(
        correlationId,
        "The program frame does not match the requested revision and frame.",
      );
    }
    return { blob: await response.blob(), contentHash, frame: returnedFrame, revisionId };
  }

  previewControl(
    endpoint: string,
    body: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!/^[a-z-]+$/.test(endpoint)) throw new Error("Preview control endpoint is invalid.");
    return this.request(`/api/v1/preview/sessions/current/${endpoint}`, {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify(body),
    });
  }

  renderRequests(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/renders/requests", { method: "GET", signal: signal ?? null });
  }

  renderQueue(signal?: AbortSignal): Promise<readonly unknown[]> {
    return this.request("/api/v1/renders/queue", { method: "GET", signal: signal ?? null });
  }

  async renderArtifact(
    outputId: string,
    index: number,
    signal?: AbortSignal,
  ): Promise<Readonly<{ blob: Blob; contentHash: string; mediaType: "image/png" | "image/jpeg" }>> {
    if (this.sessionToken === null) throw missingSessionTokenError(this.#correlationId());
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(outputId) || !Number.isSafeInteger(index) || index < 0) {
      throw new Error("Render artifact identity is invalid.");
    }
    const correlationId = this.#correlationId();
    const response = await this.#fetcher(
      `${this.baseUrl}/api/v1/renders/outputs/${outputId}/artifacts/${index.toString(10)}`,
      {
        method: "GET",
        signal: signal ?? null,
        headers: {
          accept: "image/png,image/jpeg",
          authorization: `Bearer ${this.sessionToken}`,
          "x-correlation-id": correlationId,
        },
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (payload !== null && isApiEnvelope(payload) && !payload.ok) {
        throw new StudioApiError({
          ...payload.error,
          detail: payload.error.details,
          correlationId: payload.correlationId,
        });
      }
      throw protocolError(correlationId, "The Studio server could not return the immutable artifact.");
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
    const contentHash = response.headers.get("x-chai-artifact-sha256");
    if (
      (mediaType !== "image/png" && mediaType !== "image/jpeg") ||
      contentHash === null ||
      !/^[a-f0-9]{64}$/.test(contentHash)
    ) {
      throw protocolError(correlationId, "The Studio server returned invalid artifact metadata.");
    }
    return { blob: await response.blob(), contentHash, mediaType };
  }

  async assetSourceFrame(
    assetId: string,
    frame: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ blob: Blob; contentHash: string; mediaType: "image/png"; frame: string }>> {
    if (this.sessionToken === null) throw missingSessionTokenError(this.#correlationId());
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u.test(assetId) || !/^(?:0|[1-9][0-9]{0,11})$/u.test(frame)) {
      throw new Error("Source frame identity is invalid.");
    }
    const correlationId = this.#correlationId();
    const response = await this.#fetcher(
      `${this.baseUrl}/api/v1/assets/${encodeURIComponent(assetId)}/source-frame?frame=${encodeURIComponent(frame)}`,
      {
        method: "GET",
        signal: signal ?? null,
        headers: {
          accept: "image/png",
          authorization: `Bearer ${this.sessionToken}`,
          "x-correlation-id": correlationId,
        },
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (payload !== null && isApiEnvelope(payload) && !payload.ok) {
        throw new StudioApiError({
          ...payload.error,
          detail: payload.error.details,
          correlationId: payload.correlationId,
        });
      }
      throw protocolError(correlationId, "The Studio server could not decode the source frame.");
    }
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
    const contentHash = response.headers.get("x-chai-artifact-sha256");
    const returnedFrame = response.headers.get("x-chai-source-frame");
    if (
      mediaType !== "image/png" ||
      contentHash === null ||
      !/^[a-f0-9]{64}$/u.test(contentHash) ||
      returnedFrame !== frame
    ) {
      throw protocolError(correlationId, "The Studio server returned invalid source-frame metadata.");
    }
    return { blob: await response.blob(), contentHash, mediaType, frame: returnedFrame };
  }

  assetDefaultProxy(assetId: string, signal?: AbortSignal): Promise<StudioJobView> {
    assertAssetId(assetId);
    return this.request(`/api/v1/assets/${encodeURIComponent(assetId)}/proxy-default`, {
      method: "POST",
      signal: signal ?? null,
    });
  }

  studioJob(jobId: string, signal?: AbortSignal): Promise<StudioJobView> {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u.test(jobId)) throw new Error("Studio job ID is invalid.");
    return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      signal: signal ?? null,
    });
  }

  relinkAsset(
    input: Readonly<{
      assetId: string;
      sourcePath: string;
      baseRevisionId: string;
      idempotencyId: string;
    }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ status: string; resultingRevisionId: string | null }>> {
    assertAssetId(input.assetId);
    return this.request(`/api/v1/assets/${encodeURIComponent(input.assetId)}/relink`, {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({
        sourcePath: input.sourcePath,
        context: {
          baseRevisionId: input.baseRevisionId,
          idempotencyId: input.idempotencyId,
          actor: {
            id: "actor-local-studio-user",
            kind: "user",
            sessionId: "session-local-studio",
          },
        },
      }),
    });
  }

  uploadAsset(input: {
    readonly file: File;
    readonly assetId: string;
    readonly kind: "video" | "audio" | "image" | "caption" | "composition" | "data";
    readonly rights: "owned" | "licensed" | "public-domain" | "unknown";
    readonly baseRevisionId: string;
    readonly idempotencyId: string;
    readonly signal?: AbortSignal;
  }): Promise<
    Readonly<{
      asset: Readonly<Record<string, unknown>>;
      receipt: Readonly<{ status: string; resultingRevisionId: string | null }>;
      storedPath: string;
      bytesWritten: number;
    }>
  > {
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "x-chai-file-name": encodeURIComponent(input.file.name),
      "x-chai-asset-id": input.assetId,
      "x-chai-asset-kind": input.kind,
      "x-chai-asset-rights": input.rights,
      "x-chai-base-revision-id": input.baseRevisionId,
      "x-chai-idempotency-id": input.idempotencyId,
    });
    return this.request("/api/v1/assets/upload", {
      method: "POST",
      headers,
      body: input.file,
      signal: input.signal ?? null,
    });
  }

  reliabilityDiagnostics(signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/reliability/diagnostics", { method: "GET", signal: signal ?? null });
  }

  supportBundlePreview(
    recordIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/v1/reliability/support-bundle/preview", {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({ explicit: true, recordIds }),
    });
  }

  async command<T>(
    path: string,
    body: unknown,
    baseRevisionId: string | null,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = new Headers();
    if (baseRevisionId !== null) headers.set("if-match", baseRevisionId);
    return this.request<T>(path, {
      method: "POST",
      signal: signal ?? null,
      headers,
      body: JSON.stringify(body),
    });
  }

  async request<T>(path: string, init: RequestInit, authenticated = true): Promise<T> {
    if (authenticated && this.sessionToken === null) {
      throw missingSessionTokenError(this.#correlationId());
    }
    const correlationId = this.#correlationId();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-correlation-id", correlationId);
    if (init.body !== undefined && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    if (authenticated && this.sessionToken !== null)
      headers.set("authorization", `Bearer ${this.sessionToken}`);
    if (
      authenticated &&
      this.sessionToken !== null &&
      ["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase())
    ) {
      headers.set("x-chai-csrf-token", this.sessionToken);
    }
    const response = await this.#fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!isApiEnvelope(payload)) {
      throw protocolError(correlationId, `The Studio server returned an invalid envelope for ${path}.`);
    }
    if (!payload.ok) {
      const diagnostic: StudioDiagnostic = {
        ...payload.error,
        detail: payload.error.details,
        correlationId: payload.correlationId,
      };
      if (response.status === 409 || diagnostic.code.includes("revision")) {
        throw new StaleRevisionError(diagnostic);
      }
      throw new StudioApiError(diagnostic);
    }
    if (!response.ok) {
      throw protocolError(
        payload.correlationId,
        `The Studio server returned HTTP ${String(response.status)} with a success envelope.`,
      );
    }
    return payload.data;
  }
}

export const mergeServerSnapshot = (
  current: StudioSnapshot,
  patch: Partial<StudioSnapshot>,
): StudioSnapshot => ({
  ...current,
  ...patch,
  project: Object.hasOwn(patch, "project") ? (patch.project ?? null) : current.project,
  preview: patch.preview ?? current.preview,
  render: patch.render ?? current.render,
  selection: patch.selection ?? current.selection,
  assets: patch.assets ?? current.assets,
  timeline: patch.timeline ?? current.timeline,
});

const isApiEnvelope = <T>(value: unknown): value is ApiEnvelope<T> => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ApiEnvelope<T>>;
  return typeof candidate.ok === "boolean" && typeof candidate.correlationId === "string";
};

const missingSessionTokenError = (correlationId: string): StudioApiError =>
  new StudioApiError({
    category: "security",
    code: "client.session-token-missing",
    stage: "client-session",
    entityId: null,
    retryable: true,
    message: "The authenticated Studio session is not available yet.",
    repairHint: "Restart Chai Studio from the local launcher.",
    correlationId,
    detail: null,
  });

const protocolError = (correlationId: string, message: string): StudioApiError =>
  new StudioApiError({
    category: "schema",
    code: "client.api-envelope-invalid",
    stage: "client-transport",
    entityId: null,
    retryable: true,
    message,
    repairHint: "Resync the workspace. Restart the local Studio server if the problem continues.",
    correlationId,
    detail: null,
  });

const createCorrelationId = (): string => globalThis.crypto.randomUUID();

const assertAssetId = (assetId: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u.test(assetId)) throw new Error("Asset ID is invalid.");
};

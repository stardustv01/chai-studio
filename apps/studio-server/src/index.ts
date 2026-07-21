import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ChaiError, createLogger } from "@chai-studio/diagnostics";
import {
  bridgeCommandCatalog,
  bridgeDiscoveryDocument,
  createBridgeAuthorization,
  type BridgeAuthorization,
  type BridgeCapability,
  type CaptureRequest,
} from "@chai-studio/bridge";
import { deserializeRational, type JsonValue } from "@chai-studio/schema";
import type { DeliveryProfile, DeliveryProfileSeed, RenderScope } from "@chai-studio/render";
import { studioContentSecurityPolicy, studioSecurityHeaders } from "@chai-studio/security";
import {
  apiFailure,
  apiSuccess,
  requestCorrelationId,
  studioApiVersion,
  type ApiEnvelope,
} from "./api-contract.js";
import {
  acquireStudioInstance,
  publishStudioBridgeSession,
  type StudioInstanceLease,
} from "./instance-policy.js";
import { AssetApiService } from "./asset-service.js";
import { CaptureApiService } from "./capture-service.js";
import { EventReplayGapError, StudioEventHub, formatStudioServerSentEvent } from "./event-hub.js";
import { StudioInteractionService } from "./interaction-service.js";
import { StudioJobRegistry } from "./job-registry.js";
import { createLocalRenderExecutor } from "./local-render-executor.js";
import { ProjectSessionService } from "./project-service.js";
import { PreviewSessionService } from "./preview-service.js";
import { ProgramFrameService } from "./program-frame-service.js";
import { RegenerableStudioIndex } from "./regenerable-index.js";
import { RenderApiService } from "./render-service.js";
import { ReviewApiService } from "./review-service.js";
import { RuntimeHygieneService } from "./runtime-hygiene.js";
import { ReliabilityService, type RepairAction } from "./reliability-service.js";
import {
  assertLoopbackBindHost,
  authorizeStudioRequest,
  type StudioRequestSecurityPolicy,
} from "./request-security.js";

export interface StudioHealth {
  readonly status: "ok";
  readonly service: "studio-server";
  readonly contractVersion: typeof studioApiVersion;
  readonly instanceId: string;
  readonly projectScoped: boolean;
}

export interface StudioServerOptions {
  readonly sessionToken?: string;
  readonly instanceId?: string;
  readonly projectScoped?: boolean;
  readonly allowedOrigins?: () => readonly string[];
  readonly bridgeAuthorization?: BridgeAuthorization;
  readonly projectService?: ProjectSessionService;
  readonly assetService?: AssetApiService;
  readonly jobRegistry?: StudioJobRegistry;
  readonly previewService?: PreviewSessionService;
  readonly programFrameService?: ProgramFrameService;
  readonly interactionService?: StudioInteractionService;
  readonly captureService?: CaptureApiService;
  readonly renderService?: RenderApiService;
  readonly reviewService?: ReviewApiService;
  readonly eventHub?: StudioEventHub;
  readonly indexService?: RegenerableStudioIndex;
  readonly runtimeHygiene?: RuntimeHygieneService;
  readonly reliabilityService?: ReliabilityService;
}

export interface StartStudioServerOptions {
  readonly host?: "127.0.0.1" | "::1";
  readonly preferredPort?: number;
  readonly portSearchSpan?: number;
  readonly runtimeDirectory?: string;
  readonly instancePolicy?: StudioInstanceLease["policy"];
  readonly projectRoot?: string;
  readonly allowedUiOrigins?: readonly string[];
}

export interface StudioStartupReport {
  readonly status: "ready";
  readonly service: "studio-server";
  readonly apiVersion: typeof studioApiVersion;
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly origins: readonly string[];
  readonly instanceId: string;
  readonly instancePolicy: StudioInstanceLease["policy"];
  readonly instanceScopeKey: string;
  readonly projectRoot: string | null;
  readonly sessionTokenFingerprint: string;
  readonly startedAt: string;
}

export interface StartedStudioServer {
  readonly server: Server;
  readonly sessionToken: string;
  readonly report: StudioStartupReport;
  close(): Promise<void>;
}

const logger = createLogger((record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
});
const assetUploadErrorPattern = /^(?:Uploaded asset|Asset upload|Asset validation failed)/u;
const assetSourceFrameErrorPattern =
  /^(?:Source frame|Still-image source|Decoded source frame|Proxy generation)/u;
const programFrameErrorPattern = /^(?:Program frame|Visual clip|Shared visual clip|Prepared source)/u;
const studioServerShutdownHooks = new WeakMap<Server, () => Promise<void>>();

export const handleStudioRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: StudioServerOptions = {},
): Promise<void> => {
  const correlationId = requestCorrelationId(request.headers["x-correlation-id"]);
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathName = requestUrl.pathname;
  const securityPolicy: StudioRequestSecurityPolicy = {
    sessionToken: options.sessionToken ?? "unavailable-direct-handler-token",
    csrfToken: options.sessionToken ?? "unavailable-direct-handler-token",
    allowedOrigins: options.allowedOrigins ?? (() => []),
    publicPaths: new Set(["/api/health"]),
    ...(options.bridgeAuthorization === undefined
      ? {}
      : { bridgeAuthorization: options.bridgeAuthorization, bridgeCapability: bridgeCapabilityForRequest }),
  };
  let corsOrigin: string | null = null;
  let bridgeRestricted: boolean;
  try {
    const security = authorizeStudioRequest({
      method: request.method ?? "GET",
      path: pathName,
      headers: request.headers,
      correlationId,
      policy: securityPolicy,
    });
    corsOrigin = security.corsOrigin;
    bridgeRestricted = security.authentication === "bridge";
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...studioSecurityHeaders(studioContentSecurityPolicy),
        ...corsHeaders(corsOrigin),
      });
      response.end();
      return;
    }
    if (request.method === "GET" && pathName === "/api/health") {
      const payload: StudioHealth = {
        status: "ok",
        service: "studio-server",
        contractVersion: studioApiVersion,
        instanceId: options.instanceId ?? "unmanaged",
        projectScoped: options.projectScoped ?? false,
      };
      logger.write("info", "environment", "health.check", correlationId, { method: request.method });
      writeJson(response, 200, apiSuccess(correlationId, payload), corsOrigin);
      return;
    }
    if (request.method === "GET" && pathName === "/api/v1/session") {
      writeJson(
        response,
        200,
        apiSuccess(correlationId, {
          instanceId: options.instanceId ?? "unmanaged",
          projectScoped: options.projectScoped ?? false,
        }),
        corsOrigin,
      );
      return;
    }
    if (request.method === "GET" && pathName === "/api/v1/bridge/discovery") {
      writeJson(response, 200, apiSuccess(correlationId, bridgeDiscoveryDocument), corsOrigin);
      return;
    }
    if (request.method === "GET" && pathName === "/api/v1/events") {
      if (options.eventHub === undefined) {
        throw apiError(
          "internal",
          "server.event-hub-unavailable",
          correlationId,
          "event-stream",
          "Studio event hub is unavailable.",
          "Restart the local Studio server.",
        );
      }
      openStudioEventStream(request, response, requestUrl, options.eventHub, corsOrigin);
      return;
    }
    const projectRouteHandled = await handleProjectRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.projectService,
    );
    if (projectRouteHandled) return;
    const commandRouteHandled = await handleCommandRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.projectService,
      bridgeRestricted,
    );
    if (commandRouteHandled) return;
    const assetRouteHandled = await handleAssetRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.assetService,
      options.jobRegistry,
    );
    if (assetRouteHandled) return;
    const previewRouteHandled = await handlePreviewRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.previewService,
      options.programFrameService,
    );
    if (previewRouteHandled) return;
    const interactionRouteHandled = await handleInteractionRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.interactionService,
      options.renderService,
      options.captureService,
    );
    if (interactionRouteHandled) return;
    const reviewRouteHandled = await handleReviewRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.reviewService,
      bridgeRestricted,
    );
    if (reviewRouteHandled) return;
    const renderRouteHandled = await handleRenderRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.renderService,
    );
    if (renderRouteHandled) return;
    const indexRouteHandled = await handleIndexRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.indexService,
    );
    if (indexRouteHandled) return;
    const runtimeRouteHandled = await handleRuntimeRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.runtimeHygiene,
    );
    if (runtimeRouteHandled) return;
    const reliabilityRouteHandled = await handleReliabilityRoute(
      request,
      response,
      pathName,
      correlationId,
      corsOrigin,
      options.reliabilityService,
    );
    if (reliabilityRouteHandled) return;
    throw apiError(
      "environment",
      "server.route-not-found",
      correlationId,
      "routing",
      "API route was not found.",
      "Use a documented /api/v1 route.",
    );
  } catch (error) {
    const chaiError =
      error instanceof ChaiError
        ? error
        : error instanceof EventReplayGapError
          ? apiError(
              "environment",
              "server.event-replay-gap",
              correlationId,
              "event-stream",
              error.message,
              "Reload authoritative state, then reconnect from the latest available event sequence.",
            )
          : error instanceof Error && error.message === "No project is open in this Studio session."
            ? apiError(
                "schema",
                "server.project-not-open",
                correlationId,
                "project-session",
                error.message,
                "Open or create a project before using the current-project endpoint.",
              )
            : error instanceof Error && error.message === "No preview session is loaded."
              ? apiError(
                  "preview",
                  "server.preview-not-loaded",
                  correlationId,
                  "preview-session",
                  error.message,
                  "Load the current project into a preview session before controlling preview.",
                )
              : error instanceof Error && error.message.startsWith("Preview state conflict:")
                ? apiError(
                    "preview",
                    "server.preview-state-conflict",
                    correlationId,
                    "preview-session",
                    error.message,
                    "Refresh preview state and retry against its current stateVersion.",
                  )
                : error instanceof Error && /^(?:Preview|Cannot play)/.test(error.message)
                  ? requestError(correlationId, error.message)
                  : error instanceof Error && error.message.startsWith("Editor selection conflict:")
                    ? apiError(
                        "timeline",
                        "server.selection-state-conflict",
                        correlationId,
                        "editor-selection",
                        error.message,
                        "Refresh editor selection and retry against its current stateVersion.",
                      )
                    : error instanceof Error && interactionErrorPattern.test(error.message)
                      ? requestError(correlationId, error.message)
                      : error instanceof Error && lifecycleConflictPattern.test(error.message)
                        ? apiError(
                            "render",
                            "server.render-state-conflict",
                            correlationId,
                            "render-lifecycle",
                            error.message,
                            "Refresh project, job, output, and lifecycle state before retrying.",
                          )
                        : error instanceof Error && renderErrorPattern.test(error.message)
                          ? requestError(correlationId, error.message)
                          : error instanceof Error && error.message === "Studio event sequence is invalid."
                            ? requestError(correlationId, error.message)
                            : error instanceof Error &&
                                (assetUploadErrorPattern.test(error.message) ||
                                  assetSourceFrameErrorPattern.test(error.message) ||
                                  programFrameErrorPattern.test(error.message))
                              ? requestError(correlationId, error.message)
                              : error instanceof Error && indexErrorPattern.test(error.message)
                                ? requestError(correlationId, error.message)
                                : error instanceof Error && error.message.startsWith("Runtime ")
                                  ? requestError(correlationId, error.message)
                                  : apiError(
                                      "internal",
                                      "server.request-failed",
                                      correlationId,
                                      "request",
                                      "Studio request failed unexpectedly.",
                                      "Retry once and inspect the correlated local log.",
                                    );
    const statusCode =
      chaiError.code === "server.route-not-found"
        ? 404
        : chaiError.code === "server.event-replay-gap"
          ? 409
          : chaiError.code === "server.request-invalid" || chaiError.code === "command.envelope.invalid"
            ? 400
            : chaiError.code === "server.project-not-open"
              ? 409
              : chaiError.code === "server.preview-not-loaded" ||
                  chaiError.code === "server.preview-state-conflict" ||
                  chaiError.code === "server.selection-state-conflict" ||
                  chaiError.code === "server.render-state-conflict"
                ? 409
                : chaiError.code.startsWith("source.session.")
                  ? 400
                  : chaiError.code.includes(".lock.")
                    ? 423
                    : chaiError.code.includes("conflict")
                      ? 409
                      : chaiError.category === "security"
                        ? chaiError.code === "server.session-token-invalid"
                          ? 401
                          : 403
                        : 500;
    writeJson(response, statusCode, apiFailure(chaiError, false), corsOrigin);
  }
};

export const createStudioServer = (options: StudioServerOptions = {}): Server => {
  const projectService = options.projectService ?? new ProjectSessionService();
  const jobRegistry = options.jobRegistry ?? new StudioJobRegistry();
  const assetService =
    options.assetService ?? new AssetApiService({ projects: projectService, jobs: jobRegistry });
  const previewService = options.previewService ?? new PreviewSessionService({ projects: projectService });
  const programFrameService = options.programFrameService ?? new ProgramFrameService(projectService);
  const interactionService =
    options.interactionService ??
    new StudioInteractionService({ projects: projectService, preview: previewService });
  const renderService =
    options.renderService ??
    new RenderApiService({
      projects: projectService,
      jobs: jobRegistry,
      executeRender: createLocalRenderExecutor(projectService),
      compositorMode: "local-full",
    });
  const captureService =
    options.captureService ??
    new CaptureApiService({
      projects: projectService,
      interactions: interactionService,
      renders: renderService,
    });
  const reviewService = options.reviewService ?? new ReviewApiService({ projects: projectService });
  const eventHub = options.eventHub ?? new StudioEventHub();
  const indexService =
    options.indexService ?? new RegenerableStudioIndex({ projects: projectService, jobs: jobRegistry });
  const runtimeHygiene =
    options.runtimeHygiene ??
    new RuntimeHygieneService({
      projects: projectService,
      jobs: jobRegistry,
      index: indexService,
      events: eventHub,
    });
  const reliabilityService =
    options.reliabilityService ??
    new ReliabilityService({
      projects: projectService,
      runtime: runtimeHygiene,
      renders: renderService,
    });
  const unsubscribe = [
    projectService.subscribe((event) => {
      eventHub.publish({
        type: event.type,
        correlationId: event.correlationId,
        projectId: event.projectId,
        revisionId: event.revisionId,
        payload: event.payload,
      });
      if (event.type === "project.closed") {
        previewService.unload();
      } else if (event.type === "project.command") {
        void previewService.synchronize().catch(() => {
          // A correlated request or reliability scan will surface a genuine synchronization failure.
        });
      }
    }),
    previewService.subscribe((state) => {
      eventHub.publish({
        type: state === null ? "preview.unloaded" : "preview.state",
        projectId: state?.projectId ?? null,
        revisionId: state?.revisionId ?? null,
        payload: state,
      });
    }),
    interactionService.subscribe((event) => {
      eventHub.publish({
        type: event.type,
        projectId: event.projectId,
        revisionId: event.revisionId,
        payload: event.payload,
      });
    }),
    jobRegistry.subscribe((job) => {
      eventHub.publish({
        type: `job.${job.status}`,
        correlationId: job.correlationId,
        projectId: job.projectId,
        revisionId: job.revisionId,
        payload: job,
      });
    }),
  ];
  eventHub.publish({ type: "server.event-stream-ready", payload: { latestSequence: "0" } });
  const server = createServer((request, response) => {
    void handleStudioRequest(request, response, {
      ...options,
      projectService,
      assetService,
      jobRegistry,
      previewService,
      programFrameService,
      interactionService,
      captureService,
      reviewService,
      renderService,
      eventHub,
      indexService,
      runtimeHygiene,
      reliabilityService,
    });
  });
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= Promise.all([interactionService.shutdown(), runtimeHygiene.shutdown()]).then(
      () => undefined,
    );
    return shutdownPromise;
  };
  studioServerShutdownHooks.set(server, shutdown);
  server.once("close", () => {
    for (const stop of unsubscribe) stop();
    void shutdown();
  });
  const closeNative = server.close.bind(server);
  server.close = (callback?: (error?: Error) => void): Server => {
    closeNative((closeError) => {
      void shutdown().then(
        () => {
          callback?.(closeError);
        },
        (shutdownError: unknown) => {
          callback?.(
            closeError ??
              (shutdownError instanceof Error
                ? shutdownError
                : new Error("Studio graceful shutdown failed.")),
          );
        },
      );
    });
    return server;
  };
  return server;
};

const openStudioEventStream = (
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  hub: StudioEventHub,
  corsOrigin: string | null,
): void => {
  const queryAfter = requestUrl.searchParams.get("after");
  const header = request.headers["last-event-id"];
  const headerAfter = typeof header === "string" ? header : header?.[0];
  const after = queryAfter ?? headerAfter ?? "0";
  const replay = hub.replay(after);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...studioSecurityHeaders(studioContentSecurityPolicy),
    ...corsHeaders(corsOrigin),
  });
  response.flushHeaders();
  response.write("retry: 1000\n\n");
  for (const event of replay) response.write(formatStudioServerSentEvent(event));
  const stop = hub.subscribe((event) => {
    response.write(formatStudioServerSentEvent(event));
  });
  const heartbeat = setInterval(() => {
    response.write(`: heartbeat ${hub.latestSequence()}\n\n`);
  }, 15_000);
  heartbeat.unref();
  response.once("close", () => {
    clearInterval(heartbeat);
    stop();
  });
};

const handleIndexRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: RegenerableStudioIndex | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/index")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.index-service-unavailable",
      correlationId,
      "index-routing",
      "Regenerable index service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/index/status") {
    writeJson(response, 200, apiSuccess(correlationId, service.status()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/index/rebuild") {
    writeJson(response, 200, apiSuccess(correlationId, await service.rebuild()), corsOrigin);
    return true;
  }
  if (method === "DELETE" && pathName === "/api/v1/index") {
    writeJson(response, 200, apiSuccess(correlationId, await service.deleteAndRebuild()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/index/assets/search") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        service.searchAssets(
          requireBodyString(body, "text", correlationId, 4_096, true),
          requireSafeInteger(body.limit, "limit", 1, 1_000, correlationId),
        ),
      ),
      corsOrigin,
    );
    return true;
  }
  return false;
};

const handleRuntimeRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: RuntimeHygieneService | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/runtime")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.runtime-service-unavailable",
      correlationId,
      "runtime-routing",
      "Runtime hygiene service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/runtime/status") {
    writeJson(response, 200, apiSuccess(correlationId, service.status()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/runtime/disk") {
    writeJson(response, 200, apiSuccess(correlationId, await service.diskPreflight()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/runtime/activate") {
    writeJson(response, 200, apiSuccess(correlationId, await service.activate()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/runtime/changes") {
    writeJson(response, 200, apiSuccess(correlationId, service.changes()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/runtime/orphans") {
    writeJson(response, 200, apiSuccess(correlationId, await service.scanOrphans()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/runtime/orphans/quarantine") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.quarantine(
          requireBodyString(body, "relativePath", correlationId),
          requireBodyString(body, "reason", correlationId, 1_024),
        ),
      ),
      corsOrigin,
    );
    return true;
  }
  return false;
};

const handleReliabilityRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: ReliabilityService | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/reliability")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.reliability-service-unavailable",
      correlationId,
      "reliability-routing",
      "Reliability and recovery service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/reliability/health") {
    writeJson(response, 200, apiSuccess(correlationId, await service.startupHealth()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/reliability/repair-scan") {
    writeJson(response, 200, apiSuccess(correlationId, await service.scan()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/reliability/diagnostics") {
    writeJson(response, 200, apiSuccess(correlationId, await service.diagnostics()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/reliability/repair") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.repair({
          issueId: requireBodyString(body, "issueId", correlationId),
          action: requireRepairAction(body.action, correlationId),
          actor: requireActor(body.actor, correlationId),
          ...(body.targetRevisionId === undefined
            ? {}
            : { targetRevisionId: requireBodyString(body, "targetRevisionId", correlationId) }),
          ...(body.targetRelativePath === undefined
            ? {}
            : { targetRelativePath: requireBodyString(body, "targetRelativePath", correlationId) }),
          ...(body.expectedContentHash === undefined
            ? {}
            : { expectedContentHash: requireBodyString(body, "expectedContentHash", correlationId, 64) }),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/reliability/support-bundle/preview") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.supportBundlePreview({
          explicit: requireBoolean(body.explicit, "explicit", correlationId),
          recordIds: requireStringArray(body.recordIds, "recordIds", correlationId, 2_000),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/reliability/support-bundle/export") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.exportSupportBundle({
          explicit: requireBoolean(body.explicit, "explicit", correlationId),
          recordIds: requireStringArray(body.recordIds, "recordIds", correlationId, 2_000),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/reliability/crashes") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.recordLocalCrash({
          summary: requireBodyString(body, "summary", correlationId, 1_024),
          correlationId,
          details: body.details ?? null,
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  return false;
};

const handleRenderRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: RenderApiService | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/renders") && !pathName.startsWith("/api/v1/security/trust")) {
    return false;
  }
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.render-service-unavailable",
      correlationId,
      "render-routing",
      "Render service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/security/trust") {
    writeJson(response, 200, apiSuccess(correlationId, await service.securityWorkspace()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/security/trust/classify") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.classifyComposition({
          compositionId: requireBodyString(body, "compositionId", correlationId, 128),
          sourceHash: requireBodyString(body, "sourceHash", correlationId, 64),
          trustClass: requireEnum(
            body.trustClass,
            ["trusted_authored", "imported_untrusted"] as const,
            "trustClass",
            correlationId,
          ),
          classifiedBy: requireBodyString(body, "classifiedBy", correlationId, 128),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  const trustPromotionMatch = /^\/api\/v1\/security\/trust\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/promote$/.exec(
    pathName,
  );
  if (method === "POST" && trustPromotionMatch !== null) {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.promoteComposition({
          schemaVersion: "1.0.0",
          id: requireBodyString(body, "reviewId", correlationId, 128),
          compositionId: trustPromotionMatch[1] ?? "",
          sourceHash: requireBodyString(body, "sourceHash", correlationId, 64),
          reviewerId: requireBodyString(body, "reviewerId", correlationId, 128),
          decision: requireEnum(body.decision, ["approved", "rejected"] as const, "decision", correlationId),
          checklist: requireStringArray(body.checklist, "checklist", correlationId, 32),
          reviewedAt: requireBodyString(body, "reviewedAt", correlationId, 64),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/renders/profiles") {
    writeJson(response, 200, apiSuccess(correlationId, await service.profiles()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/renders/profiles") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.saveCustomProfile(requireDeliveryProfileSeed(body.profile, correlationId)),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/renders/requests") {
    writeJson(response, 200, apiSuccess(correlationId, await service.requests()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/renders/queue") {
    writeJson(response, 200, apiSuccess(correlationId, await service.queue()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/renders/preflight") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.preflight({
          profile: requireDeliveryProfile(body.profile, correlationId),
          scope: requireRenderScope(body.scope, correlationId),
          expectedRevisionId: requireBodyString(body, "expectedRevisionId", correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/renders") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      202,
      apiSuccess(
        correlationId,
        await service.enqueue({
          profile: {
            ...requireDeliveryProfile(body.profile, correlationId),
          },
          scope: requireRenderScope(body.scope, correlationId),
          name: requireBodyString(body, "name", correlationId, 128),
          priority: requireSafeInteger(body.priority, "priority", -100, 100, correlationId),
          actor: requireActor(body.actor, correlationId),
          expectedRevisionId: requireBodyString(body, "expectedRevisionId", correlationId),
          correlationId,
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/renders/outputs") {
    writeJson(response, 200, apiSuccess(correlationId, await service.outputs()), corsOrigin);
    return true;
  }
  const artifactMatch =
    /^\/api\/v1\/renders\/outputs\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/artifacts\/([0-9]{1,6})$/.exec(pathName);
  if (artifactMatch !== null && method === "GET") {
    const payload = await service.artifact(
      artifactMatch[1] ?? "",
      Number.parseInt(artifactMatch[2] ?? "-1", 10),
    );
    writeArtifact(response, payload, corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/renders/queue/clear-completed") {
    writeJson(response, 200, apiSuccess(correlationId, await service.clearCompleted()), corsOrigin);
    return true;
  }
  const jobMatch = /^\/api\/v1\/renders\/jobs\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/(retry|cancel)$/.exec(
    pathName,
  );
  if (jobMatch !== null && method === "POST") {
    const jobId = jobMatch[1] ?? "";
    const action = jobMatch[2];
    writeJson(
      response,
      action === "retry" ? 202 : 200,
      apiSuccess(
        correlationId,
        action === "retry" ? await service.retry(jobId, correlationId) : service.cancel(jobId),
      ),
      corsOrigin,
    );
    return true;
  }
  const queueControlMatch =
    /^\/api\/v1\/renders\/jobs\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/(duplicate|reprioritize)$/.exec(pathName);
  if (queueControlMatch !== null && method === "POST") {
    const jobId = queueControlMatch[1] ?? "";
    const action = queueControlMatch[2];
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      action === "duplicate" ? 202 : 200,
      apiSuccess(
        correlationId,
        action === "duplicate"
          ? await service.duplicate(jobId, correlationId)
          : service.reprioritize(
              jobId,
              requireSafeInteger(body.priority, "priority", -100, 100, correlationId),
            ),
      ),
      corsOrigin,
    );
    return true;
  }
  const checklistMatch =
    /^\/api\/v1\/renders\/outputs\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/qa\/checklist\/([A-Za-z][A-Za-z0-9._:-]{2,127})$/.exec(
      pathName,
    );
  if (checklistMatch !== null && method === "POST") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.recordChecklistItem({
          outputId: checklistMatch[1] ?? "",
          itemId: checklistMatch[2] ?? "",
          status: requireEnum(body.status, ["passed", "failed"] as const, "status", correlationId),
          reviewerId: requireBodyString(body, "reviewerId", correlationId, 128),
          evidenceHashes: requireHashArray(body.evidenceHashes, "evidenceHashes", correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  const outputMatch =
    /^\/api\/v1\/renders\/outputs\/([A-Za-z][A-Za-z0-9._:-]{2,127})(?:\/(receipt|qa|approve|deliver))?$/.exec(
      pathName,
    );
  if (outputMatch === null) return false;
  const outputId = outputMatch[1] ?? "";
  const action = outputMatch[2];
  if (method === "GET" && action === undefined) {
    writeJson(response, 200, apiSuccess(correlationId, await service.output(outputId)), corsOrigin);
    return true;
  }
  if (method === "GET" && action === "receipt") {
    writeJson(response, 200, apiSuccess(correlationId, await service.receipt(outputId)), corsOrigin);
    return true;
  }
  if (method === "GET" && action === "qa") {
    writeJson(response, 200, apiSuccess(correlationId, await service.qaWorkspace(outputId)), corsOrigin);
    return true;
  }
  if (method !== "POST" || (action !== "qa" && action !== "approve" && action !== "deliver")) return false;
  const body = await readJsonBody(request, correlationId);
  if (action === "qa") {
    writeJson(
      response,
      202,
      apiSuccess(
        correlationId,
        await service.enqueueQa({
          outputId,
          actor: requireActor(body.actor, correlationId),
          expectedRevisionId: requireBodyString(body, "expectedRevisionId", correlationId),
          correlationId,
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (action === "deliver") {
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.deliver({
          outputId,
          actor: requireActor(body.actor, correlationId),
          expectedRevisionId: requireBodyString(body, "expectedRevisionId", correlationId),
          evidenceHashes: requireHashArray(body.evidenceHashes, "evidenceHashes", correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  writeJson(
    response,
    200,
    apiSuccess(
      correlationId,
      await service.approve({
        outputId,
        actor: requireActor(body.actor, correlationId),
        expectedRevisionId: requireBodyString(body, "expectedRevisionId", correlationId),
        evidenceHashes: requireHashArray(body.evidenceHashes, "evidenceHashes", correlationId),
        exceptionIds: requireStringArray(body.exceptionIds, "exceptionIds", correlationId, 256),
      }),
    ),
    corsOrigin,
  );
  return true;
};

const handleInteractionRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: StudioInteractionService | undefined,
  renders: RenderApiService | undefined,
  captureJobs: CaptureApiService | undefined,
): Promise<boolean> => {
  const prefixes = [
    "/api/v1/editor",
    "/api/v1/captures",
    "/api/v1/capture-jobs",
    "/api/v1/annotations",
    "/api/v1/comparisons",
    "/api/v1/source-edits",
  ];
  if (!prefixes.some((prefix) => pathName.startsWith(prefix))) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.interaction-service-unavailable",
      correlationId,
      "interaction-routing",
      "Editor interaction service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "POST" && pathName === "/api/v1/capture-jobs") {
    if (captureJobs === undefined) {
      throw apiError(
        "internal",
        "server.capture-job-service-unavailable",
        correlationId,
        "capture-job",
        "Exact capture job service is unavailable.",
        "Restart the local Studio server.",
      );
    }
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      202,
      apiSuccess(correlationId, await captureJobs.start(captureRequest(body, correlationId))),
      corsOrigin,
    );
    return true;
  }
  const captureJobMatch = /^\/api\/v1\/capture-jobs\/([A-Za-z][A-Za-z0-9._:-]{2,127})$/u.exec(pathName);
  if ((method === "GET" || method === "DELETE") && captureJobMatch !== null) {
    if (captureJobs === undefined) {
      throw apiError(
        "internal",
        "server.capture-job-service-unavailable",
        correlationId,
        "capture-job",
        "Exact capture job service is unavailable.",
        "Restart the local Studio server.",
      );
    }
    const id = captureJobMatch[1] ?? "";
    writeJson(
      response,
      200,
      apiSuccess(correlationId, method === "DELETE" ? captureJobs.cancel(id) : captureJobs.state(id)),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/editor/selection") {
    writeJson(response, 200, apiSuccess(correlationId, await service.selection()), corsOrigin);
    return true;
  }
  if (method === "PUT" && pathName === "/api/v1/editor/selection") {
    const body = await readJsonBody(request, correlationId);
    const ids = requireStringArray(body.ids, "ids", correlationId, 256);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.setSelection({
          ids,
          primaryId: requireNullableId(body.primaryId, "primaryId", correlationId),
          anchorId: requireNullableId(body.anchorId, "anchorId", correlationId),
          mode: requireEnum(body.mode, ["replace", "add", "toggle"] as const, "mode", correlationId),
          expectedStateVersion: requireSafeInteger(
            body.expectedStateVersion,
            "expectedStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/editor/context") {
    writeJson(response, 200, apiSuccess(correlationId, await service.context()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/captures") {
    writeJson(response, 200, apiSuccess(correlationId, await service.listCaptures()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/captures/from-render") {
    if (renders === undefined) {
      throw apiError(
        "internal",
        "server.render-service-unavailable",
        correlationId,
        "capture-render",
        "Exact capture render service is unavailable.",
        "Restart the local Studio server.",
      );
    }
    const body = await readJsonBody(request, correlationId);
    const output = await renders.output(requireBodyString(body, "outputId", correlationId, 128));
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.createCaptureFromRender({
          label: requireBodyString(body, "label", correlationId),
          output,
          expectedPreviewStateVersion: requireSafeInteger(
            body.expectedPreviewStateVersion,
            "expectedPreviewStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/captures") {
    const body = await readJsonBody(request, correlationId, 25_000_000);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.createCapture({
          label: requireBodyString(body, "label", correlationId),
          imageBase64: requireBodyString(body, "imageBase64", correlationId, 24_000_000),
          expectedPreviewStateVersion: requireSafeInteger(
            body.expectedPreviewStateVersion,
            "expectedPreviewStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/annotations") {
    writeJson(response, 200, apiSuccess(correlationId, await service.listAnnotations()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/annotations") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.createAnnotation({
          entityIds: requireStringArray(body.entityIds, "entityIds", correlationId, 64),
          frame: requireNullableFrame(body.frame, "frame", correlationId),
          captureId: requireNullableId(body.captureId, "captureId", correlationId),
          body: requireBodyString(body, "body", correlationId, 16_384),
          ...(body.category === undefined
            ? {
                severity: requireEnum(
                  body.severity,
                  ["note", "warning", "error"] as const,
                  "severity",
                  correlationId,
                ),
              }
            : {
                category: requireEnum(
                  body.category,
                  ["note", "issue", "privacy", "approval", "guide"] as const,
                  "category",
                  correlationId,
                ),
              }),
          ...(body.color === undefined ? {} : { color: requireBodyString(body, "color", correlationId, 9) }),
          ...(body.privacyBehavior === undefined
            ? {}
            : {
                privacyBehavior: requireEnum(
                  body.privacyBehavior,
                  ["none", "redact-preview-and-export"] as const,
                  "privacyBehavior",
                  correlationId,
                ),
              }),
          author: requireActor(body.author, correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  const annotationMatch = /^\/api\/v1\/annotations\/(annotation-[A-Za-z0-9-]{8,100})$/.exec(pathName);
  if (annotationMatch !== null) {
    const id = annotationMatch[1] ?? "";
    if (method === "DELETE") {
      writeJson(
        response,
        200,
        apiSuccess(correlationId, { deleted: await service.deleteAnnotation(id) }),
        corsOrigin,
      );
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request, correlationId);
      writeJson(
        response,
        200,
        apiSuccess(
          correlationId,
          await service.updateAnnotation(id, {
            ...(body.body === undefined
              ? {}
              : { body: requireBodyString(body, "body", correlationId, 16_384) }),
            ...(body.category === undefined && body.severity === undefined
              ? {}
              : {
                  category:
                    body.category === undefined
                      ? requireEnum(
                          body.severity,
                          ["note", "warning", "error"] as const,
                          "severity",
                          correlationId,
                        ) === "note"
                        ? ("note" as const)
                        : ("issue" as const)
                      : requireEnum(
                          body.category,
                          ["note", "issue", "privacy", "approval", "guide"] as const,
                          "category",
                          correlationId,
                        ),
                }),
            ...(body.visible === undefined && body.resolved === undefined
              ? {}
              : {
                  visible:
                    body.visible === undefined
                      ? !requireBoolean(body.resolved, "resolved", correlationId)
                      : requireBoolean(body.visible, "visible", correlationId),
                }),
            ...(body.locked === undefined
              ? {}
              : { locked: requireBoolean(body.locked, "locked", correlationId) }),
            ...(body.color === undefined
              ? {}
              : { color: requireBodyString(body, "color", correlationId, 9) }),
            ...(body.privacyBehavior === undefined
              ? {}
              : {
                  privacyBehavior: requireEnum(
                    body.privacyBehavior,
                    ["none", "redact-preview-and-export"] as const,
                    "privacyBehavior",
                    correlationId,
                  ),
                }),
          }),
        ),
        corsOrigin,
      );
      return true;
    }
    return false;
  }
  if (method === "GET" && pathName === "/api/v1/comparisons") {
    writeJson(response, 200, apiSuccess(correlationId, await service.listComparisons()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/comparisons") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.createComparison({
          leftCaptureId: requireBodyString(body, "leftCaptureId", correlationId),
          rightCaptureId: requireBodyString(body, "rightCaptureId", correlationId),
          mode: requireEnum(
            body.mode,
            ["side-by-side", "wipe", "difference", "onion-skin"] as const,
            "mode",
            correlationId,
          ),
          split: requireBoundedNumber(body.split, "split", 0, 1, correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  const comparisonMatch = /^\/api\/v1\/comparisons\/(comparison-[A-Za-z0-9-]{8,100})$/.exec(pathName);
  if (comparisonMatch !== null && method === "DELETE") {
    writeJson(
      response,
      200,
      apiSuccess(correlationId, { deleted: await service.deleteComparison(comparisonMatch[1] ?? "") }),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/source-edits/begin") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.beginSourceEdit({
          path: requireBodyString(body, "path", correlationId),
          actor: requireActor(body.actor, correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  const sourceEditMatch =
    /^\/api\/v1\/source-edits\/(source-session-[A-Za-z0-9-]{8,100})(?:\/(commit|abort))?$/.exec(pathName);
  if (sourceEditMatch === null) return false;
  const sourceSessionId = sourceEditMatch[1] ?? "";
  const action = sourceEditMatch[2];
  if (method === "GET" && action === undefined) {
    writeJson(
      response,
      200,
      apiSuccess(correlationId, await service.sourceEdit(sourceSessionId)),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && action === "abort") {
    writeJson(
      response,
      200,
      apiSuccess(correlationId, { aborted: await service.abortSourceEdit(sourceSessionId) }),
      corsOrigin,
    );
    return true;
  }
  if (method === "POST" && action === "commit") {
    const body = await readJsonBody(request, correlationId, 2_100_000);
    const receipt = await service.commitSourceEdit(
      sourceSessionId,
      requireBodyString(body, "content", correlationId, 2_000_000, true),
    );
    if (writeReceiptFailure(response, receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 200, apiSuccess(correlationId, receipt), corsOrigin);
    return true;
  }
  return false;
};

const handleReviewRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: ReviewApiService | undefined,
  bridgeRestricted: boolean,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/review")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.review-service-unavailable",
      correlationId,
      "review-routing",
      "Review service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/review/workspace") {
    writeJson(response, 200, apiSuccess(correlationId, await service.workspace()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/review/operations") {
    const body = await readJsonBody(request, correlationId);
    const operation = requireObject(body.operation, "operation", correlationId);
    if (typeof operation.kind !== "string" || !/^review\.[a-z.-]+$/.test(operation.kind)) {
      throw requestError(correlationId, "Review operation kind is invalid.");
    }
    if (bridgeRestricted) assertBridgeSafeReviewOperation(operation, correlationId);
    writeJson(
      response,
      201,
      apiSuccess(
        correlationId,
        await service.apply({
          actor: requireActor(body.actor, correlationId),
          operation: operation as JsonValue,
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  return false;
};

const handlePreviewRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: PreviewSessionService | undefined,
  programFrames: ProgramFrameService | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/preview")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.preview-service-unavailable",
      correlationId,
      "preview-routing",
      "Preview session service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/preview/program-frame") {
    if (programFrames === undefined) {
      throw apiError(
        "internal",
        "server.program-frame-service-unavailable",
        correlationId,
        "preview-routing",
        "Program frame service is unavailable.",
        "Restart the local Studio server.",
      );
    }
    const requestUrl = new URL(request.url ?? pathName, "http://127.0.0.1");
    const frame = requestUrl.searchParams.get("frame") ?? "";
    writeProgramFrame(response, await programFrames.frame(frame), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/preview/sessions/load") {
    writeJson(response, 201, apiSuccess(correlationId, await service.load()), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/preview/sessions/unload") {
    writeJson(response, 200, apiSuccess(correlationId, service.unload()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/preview/sessions/current") {
    writeJson(response, 200, apiSuccess(correlationId, await service.status()), corsOrigin);
    return true;
  }
  if (method === "GET" && pathName === "/api/v1/preview/sessions/current/adapters") {
    writeJson(response, 200, apiSuccess(correlationId, service.diagnostics()), corsOrigin);
    return true;
  }
  if (method !== "POST") return false;
  if (pathName === "/api/v1/preview/sessions/current/preload") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.preload({
          beforeFrames: requireSafeInteger(body.beforeFrames, "beforeFrames", 0, 600, correlationId),
          afterFrames: requireSafeInteger(body.afterFrames, "afterFrames", 0, 600, correlationId),
          expectedStateVersion: requireSafeInteger(
            body.expectedStateVersion,
            "expectedStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (pathName === "/api/v1/preview/sessions/current/step-seconds") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.control(
          {
            kind: "step-seconds",
            seconds: requireNonZeroSafeInteger(body.seconds, "seconds", -3_600, 3_600, correlationId),
          },
          requireSafeInteger(
            body.expectedStateVersion,
            "expectedStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        ),
      ),
      corsOrigin,
    );
    return true;
  }
  if (pathName === "/api/v1/preview/sessions/current/play-rate") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.control(
          { kind: "play-rate", playRate: requirePreviewRational(body.playRate, correlationId) },
          requireSafeInteger(
            body.expectedStateVersion,
            "expectedStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        ),
      ),
      corsOrigin,
    );
    return true;
  }
  if (
    pathName === "/api/v1/preview/sessions/current/loop-range" ||
    pathName === "/api/v1/preview/sessions/current/in-out-range"
  ) {
    const body = await readJsonBody(request, correlationId);
    const range =
      body.range === null
        ? null
        : (() => {
            const candidate = requireObject(body.range, "range", correlationId);
            return {
              startFrame: requireFrameString(candidate.startFrame, "range.startFrame", correlationId),
              endFrameExclusive: requireFrameString(
                candidate.endFrameExclusive,
                "range.endFrameExclusive",
                correlationId,
              ),
            };
          })();
    writeJson(
      response,
      200,
      apiSuccess(
        correlationId,
        await service.control(
          {
            kind: pathName === "/api/v1/preview/sessions/current/loop-range" ? "loop-range" : "in-out-range",
            range,
          },
          requireSafeInteger(
            body.expectedStateVersion,
            "expectedStateVersion",
            1,
            Number.MAX_SAFE_INTEGER,
            correlationId,
          ),
        ),
      ),
      corsOrigin,
    );
    return true;
  }
  const controlRoutes = new Map<string, "transport" | "seek" | "step" | "quality">([
    ["/api/v1/preview/sessions/current/transport", "transport"],
    ["/api/v1/preview/sessions/current/seek", "seek"],
    ["/api/v1/preview/sessions/current/step", "step"],
    ["/api/v1/preview/sessions/current/quality", "quality"],
  ]);
  const route = controlRoutes.get(pathName);
  if (route === undefined) return false;
  const body = await readJsonBody(request, correlationId);
  const expectedStateVersion = requireSafeInteger(
    body.expectedStateVersion,
    "expectedStateVersion",
    1,
    Number.MAX_SAFE_INTEGER,
    correlationId,
  );
  const control =
    route === "transport"
      ? {
          kind: requireEnum(body.action, ["play", "pause", "stop"] as const, "action", correlationId),
        }
      : route === "seek"
        ? { kind: "seek" as const, frame: requireFrameString(body.frame, "frame", correlationId) }
        : route === "step"
          ? {
              kind: "step" as const,
              delta: requireNonZeroSafeInteger(body.delta, "delta", -1_000, 1_000, correlationId),
            }
          : {
              kind: "quality" as const,
              quality: requireEnum(
                body.quality,
                ["draft", "balanced", "full"] as const,
                "quality",
                correlationId,
              ),
              truthMode: requireEnum(
                body.truthMode,
                ["interactive-approximation", "rendered-fidelity"] as const,
                "truthMode",
                correlationId,
              ),
            };
  writeJson(
    response,
    200,
    apiSuccess(correlationId, await service.control(control, expectedStateVersion)),
    corsOrigin,
  );
  return true;
};

const handleProjectRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: ProjectSessionService | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/projects")) return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.project-service-unavailable",
      correlationId,
      "project-routing",
      "Project service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const route = `${request.method ?? "GET"} ${pathName}`;
  let data: unknown;
  let statusCode = 200;
  switch (route) {
    case "POST /api/v1/projects/create": {
      const body = await readJsonBody(request, correlationId);
      data = await service.create({
        targetPath: requireBodyString(body, "targetPath", correlationId),
        title: requireBodyString(body, "title", correlationId),
        starter: requireEnum(
          body.starter ?? "empty",
          ["empty", "showcase", "launch-film"] as const,
          "starter",
          correlationId,
        ),
      });
      statusCode = 201;
      break;
    }
    case "POST /api/v1/projects/open": {
      const body = await readJsonBody(request, correlationId);
      data = await service.open(requireBodyString(body, "rootPath", correlationId));
      break;
    }
    case "POST /api/v1/projects/close":
      data = await service.close();
      break;
    case "GET /api/v1/projects/recent":
      data = service.listRecent();
      break;
    case "GET /api/v1/projects/current/snapshot":
      data = await service.snapshot();
      break;
    case "GET /api/v1/projects/current/revisions":
      data = await service.revisionHistory();
      break;
    case "GET /api/v1/projects/current/named-versions":
      data = await service.namedVersions();
      break;
    case "GET /api/v1/projects/current/migration-report":
      data = await service.migrationReport();
      break;
    case "GET /api/v1/projects/current/repair-report":
      data = await service.repairReport();
      break;
    default:
      return false;
  }
  writeJson(response, statusCode, apiSuccess(correlationId, data), corsOrigin);
  return true;
};

const handleCommandRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: ProjectSessionService | undefined,
  bridgeRestricted: boolean,
): Promise<boolean> => {
  if (pathName !== "/api/v1/commands") return false;
  if (request.method !== "POST") return false;
  if (service === undefined) {
    throw apiError(
      "internal",
      "server.project-service-unavailable",
      correlationId,
      "command-routing",
      "Project service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const body = await readJsonBody(request, correlationId);
  if (bridgeRestricted) assertBridgeSafeCommand(body, correlationId);
  const receipt = await service.executeCommand(body);
  if (receipt.status === "failed" && receipt.error !== null) {
    const error = new ChaiError({
      category: "schema",
      code: receipt.error.code,
      correlationId,
      stage: "command-execution",
      message: receipt.error.message,
      repairHint: receipt.error.retryable
        ? "Refresh the current revision and retry with a new idempotency ID."
        : "Repair the command envelope or project state before retrying.",
      details: { receipt },
    });
    writeJson(
      response,
      receipt.error.code === "command.base-revision.stale" ? 409 : 422,
      apiFailure(error, receipt.error.retryable),
      corsOrigin,
    );
    return true;
  }
  writeJson(response, 200, apiSuccess(correlationId, receipt), corsOrigin);
  return true;
};

const handleAssetRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathName: string,
  correlationId: string,
  corsOrigin: string | null,
  service: AssetApiService | undefined,
  jobs: StudioJobRegistry | undefined,
): Promise<boolean> => {
  if (!pathName.startsWith("/api/v1/assets") && !pathName.startsWith("/api/v1/jobs")) return false;
  if (service === undefined || jobs === undefined) {
    throw apiError(
      "internal",
      "server.asset-service-unavailable",
      correlationId,
      "asset-routing",
      "Asset or job service is unavailable.",
      "Restart the local Studio server.",
    );
  }
  const method = request.method ?? "GET";
  if (method === "GET" && pathName === "/api/v1/jobs") {
    writeJson(response, 200, apiSuccess(correlationId, jobs.list()), corsOrigin);
    return true;
  }
  const jobMatch = /^\/api\/v1\/jobs\/([A-Za-z][A-Za-z0-9._:-]{2,127})(?:\/(cancel))?$/.exec(pathName);
  if (jobMatch !== null) {
    const jobId = jobMatch[1] ?? "";
    if (method === "GET" && jobMatch[2] === undefined) {
      writeJson(response, 200, apiSuccess(correlationId, jobs.get(jobId)), corsOrigin);
      return true;
    }
    if (method === "POST" && jobMatch[2] === "cancel") {
      writeJson(response, 200, apiSuccess(correlationId, jobs.cancel(jobId)), corsOrigin);
      return true;
    }
    return false;
  }
  if (method === "POST" && pathName === "/api/v1/assets/import") {
    const body = await readJsonBody(request, correlationId);
    const result = await service.importAsset({
      sourcePath: requireBodyString(body, "sourcePath", correlationId),
      id: requireBodyString(body, "id", correlationId),
      kind: requireAssetKind(body.kind, correlationId),
      rights: requireAssetRights(body.rights, correlationId),
      context: requireMutationContext(body.context, correlationId),
    });
    if (writeReceiptFailure(response, result.receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 200, apiSuccess(correlationId, result), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/assets/upload") {
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/octet-stream(?:;|$)/iu.test(contentType)) {
      throw requestError(correlationId, "Asset upload body must use application/octet-stream.");
    }
    const result = await service.importUploadedAsset({
      fileName: decodeUploadHeader(
        requireRequestHeader(request, "x-chai-file-name", correlationId),
        "x-chai-file-name",
        correlationId,
      ),
      id: requireRequestHeader(request, "x-chai-asset-id", correlationId),
      kind: requireAssetKind(
        requireRequestHeader(request, "x-chai-asset-kind", correlationId),
        correlationId,
      ),
      rights: requireAssetRights(
        requireRequestHeader(request, "x-chai-asset-rights", correlationId),
        correlationId,
      ),
      content: request,
      context: {
        baseRevisionId: requireRequestHeader(request, "x-chai-base-revision-id", correlationId),
        idempotencyId: requireRequestHeader(request, "x-chai-idempotency-id", correlationId),
        actor: requireUploadActor(request, correlationId),
      },
    });
    if (writeReceiptFailure(response, result.receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 201, apiSuccess(correlationId, result), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/assets/rights") {
    const body = await readJsonBody(request, correlationId);
    const records = body.records;
    if (!Array.isArray(records)) throw requestError(correlationId, "Rights records must be an array.");
    const receipt = await service.updateRights({
      records: records as Parameters<AssetApiService["updateRights"]>[0]["records"],
      context: requireMutationContext(body.context, correlationId),
    });
    if (writeReceiptFailure(response, receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 200, apiSuccess(correlationId, receipt), corsOrigin);
    return true;
  }
  if (method === "POST" && pathName === "/api/v1/assets/search") {
    const body = await readJsonBody(request, correlationId);
    writeJson(
      response,
      200,
      apiSuccess(correlationId, await service.search(requireAssetSearchQuery(body.query, correlationId))),
      corsOrigin,
    );
    return true;
  }
  const sourceFrameMatch = /^\/api\/v1\/assets\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/source-frame$/.exec(
    pathName,
  );
  if (method === "GET" && sourceFrameMatch !== null) {
    const requestUrl = new URL(request.url ?? pathName, "http://127.0.0.1");
    const frame = requestUrl.searchParams.get("frame");
    if (frame === null) throw requestError(correlationId, "Source frame query is required.");
    writeAssetSourceFrame(
      response,
      await service.sourceFrame({ assetId: sourceFrameMatch[1] ?? "", frame }),
      corsOrigin,
    );
    return true;
  }
  const actionMatch =
    /^\/api\/v1\/assets\/([A-Za-z][A-Za-z0-9._:-]{2,127})\/(inspect|proxy|proxy-default|thumbnail|waveform|relink|replace|usage)$/.exec(
      pathName,
    );
  if (actionMatch === null) return false;
  const assetId = actionMatch[1] ?? "";
  const action = actionMatch[2] ?? "";
  if (method === "GET" && action === "usage") {
    writeJson(response, 200, apiSuccess(correlationId, await service.usage(assetId)), corsOrigin);
    return true;
  }
  if (method !== "POST") return false;
  if (action === "inspect") {
    writeJson(
      response,
      202,
      apiSuccess(correlationId, await service.enqueueInspection(assetId, correlationId)),
      corsOrigin,
    );
    return true;
  }
  if (action === "proxy-default") {
    writeJson(
      response,
      202,
      apiSuccess(correlationId, await service.enqueueDefaultProxy(assetId, correlationId)),
      corsOrigin,
    );
    return true;
  }
  const body = await readJsonBody(request, correlationId);
  if (action === "proxy") {
    const profile = requireObject(body.profile, "profile", correlationId);
    const sourceFrames = body.sourceFrames;
    if (!Array.isArray(sourceFrames)) throw requestError(correlationId, "sourceFrames must be an array.");
    writeJson(
      response,
      202,
      apiSuccess(
        correlationId,
        await service.enqueueProxy({
          assetId,
          correlationId,
          profile: profile as unknown as Parameters<AssetApiService["enqueueProxy"]>[0]["profile"],
          sourceFrames: sourceFrames as Parameters<AssetApiService["enqueueProxy"]>[0]["sourceFrames"],
          proxyFrameCount: requireBodyString(body, "proxyFrameCount", correlationId),
        }),
      ),
      corsOrigin,
    );
    return true;
  }
  if (action === "thumbnail" || action === "waveform") {
    const profile = requireObject(body.profile, "profile", correlationId) as unknown as Parameters<
      AssetApiService["enqueueView"]
    >[0]["profile"];
    if (
      (action === "waveform" && profile.kind !== "waveform") ||
      (action === "thumbnail" && profile.kind === "waveform")
    ) {
      throw requestError(correlationId, `Profile kind does not match ${action} endpoint.`);
    }
    writeJson(
      response,
      202,
      apiSuccess(correlationId, await service.enqueueView({ assetId, correlationId, profile })),
      corsOrigin,
    );
    return true;
  }
  if (action === "relink") {
    const receipt = await service.relink({
      assetId,
      sourcePath: requireBodyString(body, "sourcePath", correlationId),
      context: requireMutationContext(body.context, correlationId),
    });
    if (writeReceiptFailure(response, receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 200, apiSuccess(correlationId, receipt), corsOrigin);
    return true;
  }
  if (action === "replace") {
    const receipt = await service.replace({
      assetId,
      sourcePath: requireBodyString(body, "sourcePath", correlationId),
      expectedContentHash: requireBodyString(body, "expectedContentHash", correlationId),
      kind: requireAssetKind(body.kind, correlationId),
      rights: requireAssetRights(body.rights, correlationId),
      context: requireMutationContext(body.context, correlationId),
    });
    if (writeReceiptFailure(response, receipt, correlationId, corsOrigin)) return true;
    writeJson(response, 200, apiSuccess(correlationId, receipt), corsOrigin);
    return true;
  }
  return false;
};

const writeReceiptFailure = (
  response: ServerResponse,
  receipt: Awaited<ReturnType<ProjectSessionService["executeCommand"]>>,
  correlationId: string,
  corsOrigin: string | null,
): boolean => {
  if (receipt.status !== "failed" || receipt.error === null) return false;
  const error = new ChaiError({
    category: "media",
    code: receipt.error.code,
    correlationId,
    stage: "asset-command",
    message: receipt.error.message,
    repairHint: receipt.error.retryable
      ? "Refresh current project and asset state, then retry with a new idempotency ID."
      : "Repair the asset request before retrying.",
    details: { receipt },
  });
  const statusCode = receipt.error.code.includes("stale") ? 409 : 422;
  writeJson(response, statusCode, apiFailure(error, receipt.error.retryable), corsOrigin);
  return true;
};

const readJsonBody = async (
  request: IncomingMessage,
  correlationId: string,
  maximumBytes = 1_048_576,
): Promise<Readonly<Record<string, unknown>>> => {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:;|$)/i.test(contentType)) {
    throw requestError(correlationId, "Request body must use application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > maximumBytes)
      throw requestError(correlationId, "JSON request body exceeds its bounded limit.");
    chunks.push(bytes);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw requestError(correlationId, "Request body is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw requestError(correlationId, "Request body must be a JSON object.");
  }
  return parsed as Readonly<Record<string, unknown>>;
};

const requireBodyString = (
  body: Readonly<Record<string, unknown>>,
  key: string,
  correlationId: string,
  maximumLength = 4_096,
  allowEmpty = false,
): string => {
  const value = body[key];
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    throw requestError(correlationId, `Request field ${key} must be a bounded string.`);
  }
  return value;
};

const requireRequestHeader = (
  request: IncomingMessage,
  name: string,
  correlationId: string,
  maximumLength = 4_096,
): string => {
  const value = request.headers[name];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw requestError(correlationId, `Request header ${name} is missing or invalid.`);
  }
  return value;
};

const decodeUploadHeader = (value: string, name: string, correlationId: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw requestError(correlationId, `Request header ${name} is not valid URI-encoded text.`);
  }
};

const requireActor = (
  value: unknown,
  correlationId: string,
): Parameters<StudioInteractionService["beginSourceEdit"]>[0]["actor"] => {
  const actor = requireObject(value, "actor", correlationId);
  const kind = requireEnum(actor.kind, ["user", "codex", "system"] as const, "actor.kind", correlationId);
  return {
    id: requireBodyString(actor, "id", correlationId),
    kind,
    sessionId: requireBodyString(actor, "sessionId", correlationId),
  };
};

const requireUploadActor = (
  request: IncomingMessage,
  correlationId: string,
): Parameters<AssetApiService["importUploadedAsset"]>[0]["context"]["actor"] => {
  const kindHeader = request.headers["x-chai-actor-kind"];
  if (kindHeader === undefined) {
    return { id: "actor-local-studio-user", kind: "user", sessionId: "session-local-studio" };
  }
  const kind = requireEnum(kindHeader, ["user", "codex", "system"] as const, "actor.kind", correlationId);
  return {
    id: requireRequestHeader(request, "x-chai-actor-id", correlationId, 128),
    kind,
    sessionId: requireRequestHeader(request, "x-chai-actor-session-id", correlationId, 128),
  };
};

const bridgeSafeReviewKinds = new Set([
  "review.bundle.create",
  "review.bundle.delete",
  "review.issue.create",
  "review.issue.transition",
  "review.comparison.create",
  "review.request.create",
  "review.take.add",
  "review.take.activate",
]);

const assertBridgeSafeReviewOperation = (
  operation: Readonly<Record<string, unknown>>,
  correlationId: string,
): void => {
  if (typeof operation.kind !== "string" || !bridgeSafeReviewKinds.has(operation.kind)) {
    throw requestError(
      correlationId,
      "Bridge review operations cannot record owner decisions or accepted exceptions.",
    );
  }
  if (operation.kind === "review.issue.transition") {
    const transition = requireObject(operation.transition, "operation.transition", correlationId);
    if (transition.to === "accepted-exception") {
      throw requestError(correlationId, "Bridge review operations cannot accept exceptions.");
    }
  }
};

const assertBridgeSafeCommand = (command: Readonly<Record<string, unknown>>, correlationId: string): void => {
  const commandActor = requireObject(command.actor, "actor", correlationId);
  if (commandActor.kind !== "codex") {
    throw requestError(correlationId, "Bridge command actor must be codex.");
  }
  if (command.kind === "review.edit") {
    const payload = requireObject(command.payload, "payload", correlationId);
    assertBridgeSafeReviewOperation(
      requireObject(payload.operation, "payload.operation", correlationId),
      correlationId,
    );
  }
};

const requireRepairAction = (value: unknown, correlationId: string): RepairAction =>
  requireEnum(
    value,
    [
      "recover-pointer",
      "adopt-orphan",
      "reject-orphan",
      "clear-stale-lock",
      "relink-asset",
      "adopt-external-source",
      "quarantine-path",
      "cleanup-interrupted-job",
      "restore-autosave",
    ] as const,
    "action",
    correlationId,
  );

const requireStringArray = (
  value: unknown,
  field: string,
  correlationId: string,
  maximumLength: number,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw requestError(correlationId, `Request field ${field} must be a bounded string array.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(entry)) {
      throw requestError(correlationId, `Request field ${field} contains an invalid ID.`);
    }
    return entry;
  });
};

const requireFrameArray = (
  value: unknown,
  field: string,
  correlationId: string,
  maximumLength: number,
): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumLength) {
    throw requestError(correlationId, `Request field ${field} must be a non-empty bounded frame array.`);
  }
  return value.map((entry, index) => requireFrameString(entry, `${field}[${String(index)}]`, correlationId));
};

const requireHashArray = (value: unknown, field: string, correlationId: string): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 256 ||
    value.some((entry) => typeof entry !== "string" || !/^[a-f0-9]{64}$/.test(entry))
  ) {
    throw requestError(correlationId, `Request field ${field} must contain bounded SHA-256 hashes.`);
  }
  return value as readonly string[];
};

const requireNullableId = (value: unknown, field: string, correlationId: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw requestError(correlationId, `Request field ${field} must be a stable ID or null.`);
  }
  return value;
};

const requireNullableFrame = (value: unknown, field: string, correlationId: string): string | null =>
  value === null ? null : requireFrameString(value, field, correlationId);

const requireBoundedNumber = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  correlationId: string,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw requestError(correlationId, `Request field ${field} is outside bounded numeric limits.`);
  }
  return value;
};

const requireObject = (
  value: unknown,
  field: string,
  correlationId: string,
): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw requestError(correlationId, `Request field ${field} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const requireDeliveryProfile = (value: unknown, correlationId: string): DeliveryProfile =>
  requireObject(value, "profile", correlationId) as unknown as DeliveryProfile;

const requireDeliveryProfileSeed = (value: unknown, correlationId: string): DeliveryProfileSeed =>
  requireObject(value, "profile", correlationId) as unknown as DeliveryProfileSeed;

const requireRenderScope = (value: unknown, correlationId: string): RenderScope =>
  requireObject(value, "scope", correlationId) as unknown as RenderScope;

const captureRequest = (body: Readonly<Record<string, unknown>>, correlationId: string): CaptureRequest => {
  const kind = requireEnum(
    body.kind,
    ["isolated-selection", "before-effects", "alpha", "range", "contact-sheet"] as const,
    "kind",
    correlationId,
  );
  const range =
    body.frameRange === null || body.frameRange === undefined
      ? null
      : requireObject(body.frameRange, "frameRange", correlationId);
  return {
    kind,
    mode: "fidelity",
    frames: requireFrameArray(body.frames, "frames", correlationId, 900),
    frameRange:
      range === null
        ? null
        : {
            startFrame: requireFrameString(range.startFrame, "frameRange.startFrame", correlationId),
            endFrameExclusive: requireFrameString(
              range.endFrameExclusive,
              "frameRange.endFrameExclusive",
              correlationId,
            ),
          },
    isolatedEntityIds: requireStringArray(
      body.isolatedEntityIds ?? [],
      "isolatedEntityIds",
      correlationId,
      256,
    ),
    effectsApplied: kind !== "before-effects",
    alpha: kind === "alpha",
    comparisonSide: null,
  };
};

const requireMutationContext = (
  value: unknown,
  correlationId: string,
): Parameters<AssetApiService["importAsset"]>[0]["context"] => {
  const context = requireObject(value, "context", correlationId);
  const actor = requireObject(context.actor, "context.actor", correlationId);
  const kind = actor.kind;
  if (kind !== "user" && kind !== "codex" && kind !== "system") {
    throw requestError(correlationId, "Mutation actor kind is invalid.");
  }
  return {
    baseRevisionId: requireBodyString(context, "baseRevisionId", correlationId),
    idempotencyId: requireBodyString(context, "idempotencyId", correlationId),
    actor: {
      id: requireBodyString(actor, "id", correlationId),
      kind,
      sessionId: requireBodyString(actor, "sessionId", correlationId),
    },
  };
};

const requireAssetKind = (
  value: unknown,
  correlationId: string,
): Parameters<AssetApiService["importAsset"]>[0]["kind"] => {
  const values = ["video", "audio", "image", "caption", "composition", "data"] as const;
  const kind = values.find((candidate) => candidate === value);
  if (kind === undefined) throw requestError(correlationId, "Asset kind is invalid.");
  return kind;
};

const requireAssetRights = (
  value: unknown,
  correlationId: string,
): Parameters<AssetApiService["importAsset"]>[0]["rights"] => {
  const values = ["owned", "licensed", "public-domain", "unknown"] as const;
  const rights = values.find((candidate) => candidate === value);
  if (rights === undefined) throw requestError(correlationId, "Asset rights classification is invalid.");
  return rights;
};

const requireAssetSearchQuery = (
  value: unknown,
  correlationId: string,
): Parameters<AssetApiService["search"]>[0] => {
  const query = requireObject(value, "query", correlationId);
  const allowedKeys = new Set([
    "text",
    "kinds",
    "rights",
    "validationStates",
    "minimumDurationSeconds",
    "maximumDurationSeconds",
    "minimumWidth",
    "minimumHeight",
    "registeredAfter",
    "registeredBefore",
    "usedOnly",
    "sortBy",
    "direction",
    "offset",
    "limit",
  ]);
  const unknownKeys = Object.keys(query).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw requestError(correlationId, `Asset search query has unknown fields: ${unknownKeys.join(", ")}.`);
  }
  const result: Parameters<AssetApiService["search"]>[0] = {
    sortBy: requireEnum(
      query.sortBy,
      ["name", "type", "duration", "resolution", "rights", "status", "date", "usage"] as const,
      "query.sortBy",
      correlationId,
    ),
    direction: requireEnum(
      query.direction,
      ["ascending", "descending"] as const,
      "query.direction",
      correlationId,
    ),
    offset: requireSafeInteger(query.offset, "query.offset", 0, Number.MAX_SAFE_INTEGER, correlationId),
    limit: requireSafeInteger(query.limit, "query.limit", 1, 1_000, correlationId),
    ...(query.text === undefined
      ? {}
      : { text: requireBoundedString(query.text, "query.text", correlationId, true) }),
    ...(query.kinds === undefined
      ? {}
      : {
          kinds: requireEnumArray(
            query.kinds,
            ["video", "audio", "image", "caption", "composition", "data"] as const,
            "query.kinds",
            correlationId,
          ),
        }),
    ...(query.rights === undefined
      ? {}
      : {
          rights: requireEnumArray(
            query.rights,
            ["owned", "licensed", "public-domain", "unknown"] as const,
            "query.rights",
            correlationId,
          ),
        }),
    ...(query.validationStates === undefined
      ? {}
      : {
          validationStates: requireEnumArray(
            query.validationStates,
            ["pending", "valid", "missing", "corrupt", "unsupported"] as const,
            "query.validationStates",
            correlationId,
          ),
        }),
    ...(query.minimumDurationSeconds === undefined
      ? {}
      : { minimumDurationSeconds: requireRational(query.minimumDurationSeconds, correlationId) }),
    ...(query.maximumDurationSeconds === undefined
      ? {}
      : { maximumDurationSeconds: requireRational(query.maximumDurationSeconds, correlationId) }),
    ...(query.minimumWidth === undefined
      ? {}
      : {
          minimumWidth: requireSafeInteger(
            query.minimumWidth,
            "query.minimumWidth",
            1,
            1_000_000,
            correlationId,
          ),
        }),
    ...(query.minimumHeight === undefined
      ? {}
      : {
          minimumHeight: requireSafeInteger(
            query.minimumHeight,
            "query.minimumHeight",
            1,
            1_000_000,
            correlationId,
          ),
        }),
    ...(query.registeredAfter === undefined
      ? {}
      : {
          registeredAfter: requireIsoDateString(
            query.registeredAfter,
            "query.registeredAfter",
            correlationId,
          ),
        }),
    ...(query.registeredBefore === undefined
      ? {}
      : {
          registeredBefore: requireIsoDateString(
            query.registeredBefore,
            "query.registeredBefore",
            correlationId,
          ),
        }),
    ...(query.usedOnly === undefined
      ? {}
      : { usedOnly: requireBoolean(query.usedOnly, "query.usedOnly", correlationId) }),
  };
  return result;
};

const requireEnum = <const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  correlationId: string,
): Values[number] => {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) throw requestError(correlationId, `Request field ${field} is invalid.`);
  return match;
};

const requireEnumArray = <const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  correlationId: string,
): readonly Values[number][] => {
  if (!Array.isArray(value) || value.length > values.length) {
    throw requestError(correlationId, `Request field ${field} must be a bounded array.`);
  }
  const parsed = value.map((entry) => requireEnum(entry, values, field, correlationId));
  if (new Set(parsed).size !== parsed.length) {
    throw requestError(correlationId, `Request field ${field} must not contain duplicates.`);
  }
  return parsed;
};

const requireSafeInteger = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  correlationId: string,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw requestError(correlationId, `Request field ${field} is outside bounded safe limits.`);
  }
  return value as number;
};

const requireNonZeroSafeInteger = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  correlationId: string,
): number => {
  const parsed = requireSafeInteger(value, field, minimum, maximum, correlationId);
  if (parsed === 0) throw requestError(correlationId, `Request field ${field} must not be zero.`);
  return parsed;
};

const requireFrameString = (value: unknown, field: string, correlationId: string): string => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/.test(value)) {
    throw requestError(correlationId, `Request field ${field} must be a non-negative frame string.`);
  }
  return value;
};

const requireBoundedString = (
  value: unknown,
  field: string,
  correlationId: string,
  allowEmpty = false,
): string => {
  if (typeof value !== "string" || value.length > 4_096 || (!allowEmpty && value.trim().length === 0)) {
    throw requestError(correlationId, `Request field ${field} must be a bounded string.`);
  }
  return value;
};

const requireIsoDateString = (value: unknown, field: string, correlationId: string): string => {
  const parsed = requireBoundedString(value, field, correlationId);
  if (Number.isNaN(Date.parse(parsed))) {
    throw requestError(correlationId, `Request field ${field} must be an ISO date-time string.`);
  }
  return parsed;
};

const requireBoolean = (value: unknown, field: string, correlationId: string): boolean => {
  if (typeof value !== "boolean")
    throw requestError(correlationId, `Request field ${field} must be boolean.`);
  return value;
};

const requireRational = (value: unknown, correlationId: string): ReturnType<typeof deserializeRational> => {
  try {
    return deserializeRational(value);
  } catch {
    throw requestError(correlationId, "Asset search duration must be a normalized rational.");
  }
};

const requirePreviewRational = (
  value: unknown,
  correlationId: string,
): ReturnType<typeof deserializeRational> => {
  try {
    return deserializeRational(value);
  } catch {
    throw requestError(correlationId, "Preview play rate must be a normalized rational.");
  }
};

const requestError = (correlationId: string, message: string): ChaiError =>
  apiError(
    "schema",
    "server.request-invalid",
    correlationId,
    "request-validation",
    message,
    "Correct the request against the versioned endpoint schema and retry.",
  );

const interactionErrorPattern =
  /^(?:Editor selection|Unknown selectable|Selected entity|Selected-clip capture|Before-effects capture|Review range capture|Range capture|Contact sheet capture|Capture|Exact capture|Annotation|Unknown annotation|Comparison|Unknown comparison|Unknown capture|Preview capture)/;
const lifecycleConflictPattern =
  /^(?:Render revision conflict|QA revision conflict|Lifecycle revision conflict|Render source revision changed|Render retry requires|QA requires|Approval requires)/;
const renderErrorPattern =
  /^(?:Render profile|Delivery profile|Render scope|Render preflight|Duplicated render preflight|Render name|Render priority|Render artifact|Render artifacts|Only failed|Only queued|Only failed, cancelled|Job is not owned|Unknown render|Unknown Studio job|Lifecycle evidence|Approving qa_warning)/;
const indexErrorPattern = /^(?:Studio index|Review index)/;

export const startStudioServer = async (
  options: StartStudioServerOptions = {},
): Promise<StartedStudioServer> => {
  const host = assertLoopbackBindHost(options.host ?? "127.0.0.1");
  const preferredPort = options.preferredPort ?? 4317;
  const portSearchSpan = options.portSearchSpan ?? 20;
  assertPortOptions(preferredPort, portSearchSpan);
  const allowedUiOrigins = (options.allowedUiOrigins ?? []).map(assertLoopbackOrigin);
  const sessionToken = randomBytes(32).toString("base64url");
  const bridgeToken = randomBytes(32).toString("base64url");
  const lease = await acquireStudioInstance({
    runtimeDirectory: options.runtimeDirectory ?? path.join(os.tmpdir(), "chai-studio-runtime"),
    policy: options.instancePolicy ?? (options.projectRoot === undefined ? "single-app" : "per-project"),
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
  });
  let approvedRequestOrigins: readonly string[] = [];
  const server = createStudioServer({
    sessionToken,
    bridgeAuthorization: createBridgeAuthorization({
      id: `bridge-${lease.instanceId}`,
      sessionId: lease.instanceId,
      token: bridgeToken,
      capabilities: [...new Set(bridgeCommandCatalog.map((command) => command.capability))],
      issuedAt: new Date(lease.acquiredAt),
      expiresAt: new Date(Date.parse(lease.acquiredAt) + 7 * 24 * 60 * 60 * 1_000),
    }),
    instanceId: lease.instanceId,
    allowedOrigins: () => approvedRequestOrigins,
    projectScoped: options.projectRoot !== undefined,
  });
  let port: number;
  try {
    port = await listenOnAvailablePort(server, host, preferredPort, portSearchSpan);
  } catch (error) {
    await studioServerShutdownHooks.get(server)?.();
    await lease.release();
    throw error;
  }
  const origins = loopbackOrigins(host, port);
  approvedRequestOrigins = [...new Set([...origins, ...allowedUiOrigins])];
  const report: StudioStartupReport = {
    status: "ready",
    service: "studio-server",
    apiVersion: studioApiVersion,
    host,
    port,
    origins,
    instanceId: lease.instanceId,
    instancePolicy: lease.policy,
    instanceScopeKey: lease.scopeKey,
    projectRoot: options.projectRoot === undefined ? null : path.resolve(options.projectRoot),
    sessionTokenFingerprint: createHash("sha256").update(sessionToken).digest("hex"),
    startedAt: lease.acquiredAt,
  };
  try {
    await publishStudioBridgeSession(lease, {
      apiOrigin: report.origins[0] ?? `http://127.0.0.1:${String(port)}`,
      projectRoot: report.projectRoot,
      token: bridgeToken,
      capabilities: bridgeCommandCatalog.map((command) => command.capability),
      expiresAt: new Date(Date.parse(lease.acquiredAt) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    });
  } catch (cause) {
    await closeServer(server);
    await lease.release();
    throw cause;
  }
  logger.write("info", "environment", "server.ready", lease.instanceId, {
    host,
    port,
    instancePolicy: lease.policy,
    sessionTokenFingerprint: report.sessionTokenFingerprint,
  });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    await closeServer(server);
    await lease.release();
    closed = true;
  };
  server.once("close", () => {
    void lease.release();
  });
  return { server, sessionToken, report, close };
};

const bridgeCapabilityForRequest = (method: string, pathName: string): BridgeCapability | null => {
  if (method === "GET" && (pathName === "/api/v1/session" || pathName === "/api/v1/bridge/discovery")) {
    return "status.read";
  }
  if (pathName.startsWith("/api/v1/projects")) return method === "GET" ? "project.read" : "project.write";
  if (pathName === "/api/v1/commands") return "command.execute";
  if (pathName.startsWith("/api/v1/assets")) {
    if (method === "GET" || pathName === "/api/v1/assets/search") return "asset.read";
    if (/\/(?:inspect|proxy|proxy-default|thumbnail|waveform)$/u.test(pathName)) return "asset.process";
    return "asset.write";
  }
  if (pathName === "/api/v1/editor/selection") return method === "GET" ? "selection.read" : "selection.write";
  if (pathName === "/api/v1/editor/context") return "context.read";
  if (pathName.startsWith("/api/v1/captures") || pathName.startsWith("/api/v1/capture-jobs")) {
    return method === "GET" ? "context.read" : "capture.create";
  }
  if (pathName.startsWith("/api/v1/annotations") || pathName.startsWith("/api/v1/comparisons")) {
    return method === "GET" ? "annotation.read" : "annotation.write";
  }
  if (pathName.startsWith("/api/v1/review")) return method === "GET" ? "review.read" : "review.write";
  if (pathName.startsWith("/api/v1/source-edits")) return "source.edit";
  if (pathName.startsWith("/api/v1/preview")) return method === "GET" ? "status.read" : "preview.control";
  if (pathName === "/api/v1/jobs") return "job.read";
  if (pathName.startsWith("/api/v1/jobs/")) return method === "GET" ? "job.read" : "job.control";
  if (!pathName.startsWith("/api/v1/renders")) return null;
  if (method === "GET") {
    if (pathName.endsWith("/receipt")) return "receipt.read";
    if (pathName.endsWith("/qa")) return "qa.read";
    return "status.read";
  }
  if (/\/outputs\/[A-Za-z][A-Za-z0-9._:-]{2,127}\/qa$/u.test(pathName)) return "qa.run";
  if (/\/outputs\/[A-Za-z][A-Za-z0-9._:-]{2,127}\/(?:approve|deliver)$/u.test(pathName)) return null;
  return "render.control";
};

const listenOnAvailablePort = async (
  server: Server,
  host: "127.0.0.1" | "::1",
  preferredPort: number,
  span: number,
): Promise<number> => {
  const ports =
    preferredPort === 0 ? [0] : Array.from({ length: span + 1 }, (_, index) => preferredPort + index);
  for (const port of ports) {
    const result = await attemptListen(server, host, port);
    if (result.ok) return result.port;
    if (result.code !== "EADDRINUSE") throw result.error;
  }
  throw new Error(
    `No loopback port is available in ${String(preferredPort)}-${String(preferredPort + span)}.`,
  );
};

const attemptListen = (
  server: Server,
  host: "127.0.0.1" | "::1",
  port: number,
): Promise<Readonly<{ ok: true; port: number }> | Readonly<{ ok: false; code: string; error: Error }>> =>
  new Promise((resolve) => {
    const onError = (error: Error & { readonly code?: string }) => {
      server.off("listening", onListening);
      resolve({ ok: false, code: error.code ?? "UNKNOWN", error });
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo;
      resolve({ ok: true, port: address.port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  await studioServerShutdownHooks.get(server)?.();
  studioServerShutdownHooks.delete(server);
};

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  payload: ApiEnvelope<unknown>,
  corsOrigin: string | null,
): void => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...studioSecurityHeaders(studioContentSecurityPolicy),
    ...corsHeaders(corsOrigin),
  });
  response.end(body);
};

const writeArtifact = (
  response: ServerResponse,
  payload: Awaited<ReturnType<RenderApiService["artifact"]>>,
  corsOrigin: string | null,
): void => {
  const fileName = payload.fileName.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
  response.writeHead(200, {
    "content-type": payload.mediaType,
    "content-length": payload.bytes.byteLength,
    "content-disposition": `inline; filename="${fileName}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-chai-artifact-sha256": payload.artifact.contentHash,
    ...studioSecurityHeaders(studioContentSecurityPolicy),
    ...corsHeaders(corsOrigin),
  });
  response.end(payload.bytes);
};

const writeAssetSourceFrame = (
  response: ServerResponse,
  payload: Awaited<ReturnType<AssetApiService["sourceFrame"]>>,
  corsOrigin: string | null,
): void => {
  const fileName = payload.fileName.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
  response.writeHead(200, {
    "content-type": payload.mediaType,
    "content-length": payload.bytes.byteLength,
    "content-disposition": `inline; filename="${fileName}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-chai-artifact-sha256": payload.contentHash,
    "x-chai-source-frame": payload.frame,
    ...studioSecurityHeaders(studioContentSecurityPolicy),
    ...corsHeaders(corsOrigin),
  });
  response.end(payload.bytes);
};

const writeProgramFrame = (
  response: ServerResponse,
  payload: Awaited<ReturnType<ProgramFrameService["frame"]>>,
  corsOrigin: string | null,
): void => {
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": payload.bytes.byteLength,
    "content-disposition": `inline; filename="program-frame-${payload.frame}.png"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-chai-artifact-sha256": payload.contentHash,
    "x-chai-program-frame": payload.frame,
    "x-chai-revision-id": payload.revisionId,
    ...studioSecurityHeaders(studioContentSecurityPolicy),
    ...corsHeaders(corsOrigin),
  });
  response.end(payload.bytes);
};

const corsHeaders = (origin: string | null): Readonly<Record<string, string>> =>
  origin === null
    ? {}
    : {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers":
          "authorization,content-type,x-chai-session-token,x-chai-csrf-token,x-correlation-id,if-match,last-event-id,x-chai-file-name,x-chai-asset-id,x-chai-asset-kind,x-chai-asset-rights,x-chai-base-revision-id,x-chai-idempotency-id,x-chai-actor-id,x-chai-actor-kind,x-chai-actor-session-id",
        "access-control-expose-headers":
          "content-length,content-type,x-chai-artifact-sha256,x-chai-source-frame,x-chai-program-frame,x-chai-revision-id",
        vary: "Origin",
      };

const loopbackOrigins = (host: "127.0.0.1" | "::1", port: number): readonly string[] => {
  const hostOrigin = host === "::1" ? `http://[::1]:${String(port)}` : `http://127.0.0.1:${String(port)}`;
  return [hostOrigin, `http://localhost:${String(port)}`];
};

const assertLoopbackOrigin = (value: string): string => {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`Studio UI origin is invalid: ${value}.`);
  }
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(origin.hostname) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.port === ""
  ) {
    throw new Error(`Studio UI origin must be an exact loopback HTTP origin with a port: ${value}.`);
  }
  return origin.origin;
};

const assertPortOptions = (preferredPort: number, span: number): void => {
  if (
    !Number.isSafeInteger(preferredPort) ||
    preferredPort < 0 ||
    preferredPort > 65_535 ||
    !Number.isSafeInteger(span) ||
    span < 0 ||
    span > 1_000 ||
    preferredPort + span > 65_535
  ) {
    throw new Error("Studio server port selection is outside bounded limits.");
  }
};

const apiError = (
  category: ConstructorParameters<typeof ChaiError>[0]["category"],
  code: string,
  correlationId: string,
  stage: string,
  message: string,
  repairHint: string,
): ChaiError => new ChaiError({ category, code, correlationId, stage, message, repairHint });

export {
  apiFailure,
  apiSuccess,
  assertApiEnvelope,
  requestCorrelationId,
  studioApiVersion,
  type ApiEnvelope,
  type ApiErrorDescriptor,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
} from "./api-contract.js";
export {
  acquireStudioInstance,
  publishStudioBridgeSession,
  type StudioBridgeSessionDescriptor,
  type StudioInstanceLease,
} from "./instance-policy.js";
export {
  EventReplayGapError,
  StudioEventHub,
  formatStudioServerSentEvent,
  type StudioEvent,
  type StudioEventInput,
} from "./event-hub.js";
export { AssetApiService, type AssetMutationContext } from "./asset-service.js";
export {
  StudioInteractionService,
  type AnnotationRecord,
  type CaptureRecord,
  type CaptureComparisonView,
  type ComparisonRecord,
  type EditorContextEntity,
  type EditorContextSnapshot,
  type EditorSelectionState,
} from "./interaction-service.js";
export {
  StudioJobRegistry,
  type StudioJobKind,
  type StudioJobSnapshot,
  type StudioJobStatus,
  type StudioJobTaskContext,
} from "./job-registry.js";
export {
  ProjectSessionService,
  type OpenProjectResult,
  type ProjectRepairReport,
  type ProjectRevisionHistoryItem,
  type ProjectSchemaStatus,
  type ProjectSessionEvent,
  type RecentProjectEntry,
} from "./project-service.js";
export {
  PreviewSessionService,
  type PreviewAdapterPreloader,
  type PreviewSessionStatus,
} from "./preview-service.js";
export { ProgramFrameService, type ProgramFramePayload } from "./program-frame-service.js";
export { CaptureApiService } from "./capture-service.js";
export { RegenerableStudioIndex, type IndexedAssetRow, type StudioIndexStatus } from "./regenerable-index.js";
export {
  RenderApiService,
  renderAudioEvidenceFromMixArtifact,
  type QaEvaluator,
  type QaDeliveryPreflightResult,
  type QaReceiptRecord,
  type QaWorkspaceView,
  type RenderAudioEvidence,
  type RenderArtifactRecord,
  type RenderExecutor,
  type RenderExecutorResult,
  type RenderLifecycleEvent,
  type RenderOutputRecord,
  type RenderProfileRequest,
  type RenderQueueRecord,
  type RenderReceiptBase,
  type RenderReceiptView,
  type RenderRequestRecord,
  type RenderSecurityEvidence,
  type SecurityPreflightSummary,
} from "./render-service.js";
export { ReviewApiService, type ReviewWorkspaceSnapshot } from "./review-service.js";
export {
  RuntimeHygieneService,
  type DiskPreflightReport,
  type RuntimeFileChange,
  type RuntimeHygieneStatus,
  type RuntimeOrphanRecord,
} from "./runtime-hygiene.js";
export {
  assertLoopbackBindHost,
  authorizeStudioRequest,
  type StudioRequestSecurityPolicy,
  type StudioRequestSecurityResult,
} from "./request-security.js";
export {
  WorkerSupervisor,
  assertWorkerRpcResponse,
  spawnNdjsonWorkerTransport,
  workerRpcProtocolVersion,
  type WorkerLogRecord,
  type WorkerRpcRequest,
  type WorkerRpcResponse,
  type WorkerSupervisorDiagnostics,
  type WorkerSupervisorStatus,
  type WorkerTransport,
  type WorkerTransportFactory,
} from "./worker-supervisor.js";

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const started = await startStudioServer({
    preferredPort: Number(process.env.CHAI_STUDIO_PORT ?? "4317"),
    ...(process.env.CHAI_STUDIO_RUNTIME_DIRECTORY === undefined
      ? {}
      : { runtimeDirectory: process.env.CHAI_STUDIO_RUNTIME_DIRECTORY }),
  });
  process.stdout.write(`${JSON.stringify(started.report)}\n`);
}

import type { StudioEvent } from "./types.js";

export interface ParsedSseMessage {
  readonly id: number | null;
  readonly event: string;
  readonly data: string;
}

export interface StudioEventSubscriberOptions {
  readonly url: string;
  readonly sessionToken: string;
  readonly fetcher?: typeof fetch;
  readonly signal: AbortSignal;
  readonly lastEventId?: number | null;
  readonly onEvent: (event: StudioEvent) => void;
  readonly onConnection: (phase: "online" | "reconnecting" | "offline", attempts: number) => void;
  readonly onResyncRequired: () => Promise<void>;
}

export const parseSseMessage = (block: string): ParsedSseMessage | null => {
  let id: number | null = null;
  let event = "message";
  const data: string[] = [];
  for (const line of block.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "id" && /^\d+$/.test(value)) id = Number(value);
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0 && id === null) return null;
  return { id, event, data: data.join("\n") };
};

export const subscribeToStudioEvents = async (options: StudioEventSubscriberOptions): Promise<void> => {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  let attempts = 0;
  let lastEventId = options.lastEventId ?? null;
  while (!options.signal.aborted) {
    try {
      const headers = new Headers({
        accept: "text/event-stream",
        authorization: `Bearer ${options.sessionToken}`,
      });
      if (lastEventId !== null) headers.set("last-event-id", String(lastEventId));
      const response = await fetcher(options.url, { headers, signal: options.signal });
      if (!response.ok || response.body === null) {
        throw new Error(`Event stream failed with HTTP ${String(response.status)}.`);
      }
      attempts = 0;
      options.onConnection("online", attempts);
      for await (const message of readSseMessages(response.body, options.signal)) {
        if (message.event === "resync-required") {
          await options.onResyncRequired();
          lastEventId = message.id;
          continue;
        }
        if (message.data.length === 0) continue;
        const event = parseStudioEvent(message);
        if (event === null) continue;
        if (lastEventId !== null && event.id <= lastEventId) continue;
        lastEventId = event.id;
        options.onEvent(event);
      }
      if (!isAborted(options.signal)) throw new Error("Event stream ended before shutdown.");
    } catch (cause: unknown) {
      if (isAborted(options.signal)) return;
      attempts += 1;
      options.onConnection(attempts >= 5 ? "offline" : "reconnecting", attempts);
      await abortableDelay(Math.min(5_000, 250 * 2 ** Math.min(attempts, 4)), options.signal);
      if (cause instanceof Error && cause.name === "AbortError") return;
    }
  }
};

async function* readSseMessages(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<ParsedSseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const message = parseSseMessage(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (message !== null) yield message;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const parseStudioEvent = (message: ParsedSseMessage): StudioEvent | null => {
  if (message.id === null) return null;
  try {
    const parsed: unknown = JSON.parse(message.data);
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof payload.type !== "string" ||
      (typeof payload.correlationId !== "string" && payload.correlationId !== null) ||
      typeof payload.occurredAt !== "string" ||
      !isRecord(payload.payload)
    ) {
      return null;
    }
    return {
      id: message.id,
      type: payload.type,
      correlationId: payload.correlationId,
      occurredAt: payload.occurredAt,
      payload: payload.payload,
    };
  } catch {
    return null;
  }
};

const isAborted = (signal: AbortSignal): boolean => signal.aborted;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const abortableDelay = (durationMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

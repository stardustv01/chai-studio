export interface BridgeClientOptions {
  readonly baseUrl: string;
  readonly token: string | null;
}

export class BridgeApiClient {
  readonly #baseUrl: string;
  readonly #token: string | null;

  constructor(options: BridgeClientOptions) {
    const parsed = new URL(options.baseUrl);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
    ) {
      throw new Error("Bridge CLI only connects to a local HTTP server.");
    }
    this.#baseUrl = parsed.origin;
    this.#token = options.token;
  }

  async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(pathname, this.#baseUrl), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.#token === null ? {} : { authorization: `Bearer ${this.#token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      throw new Error(
        `Bridge request failed (${String(response.status)} ${method} ${pathname}): ${JSON.stringify(payload)}`,
      );
    }
    return unwrapApiData(payload) as T;
  }

  async upload<T>(pathname: string, filePath: string, headers: Readonly<Record<string, string>>): Promise<T> {
    const request: RequestInit & { readonly duplex: "half" } = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/octet-stream",
        ...headers,
        ...(this.#token === null ? {} : { authorization: `Bearer ${this.#token}` }),
      },
      body: Readable.toWeb(createReadStream(filePath)) as BodyInit,
      duplex: "half",
    };
    const response = await fetch(new URL(pathname, this.#baseUrl), request);
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Bridge upload failed (${String(response.status)}): ${JSON.stringify(payload)}`);
    }
    return unwrapApiData(payload) as T;
  }

  async download(pathname: string): Promise<Readonly<{ bytes: Uint8Array; contentHash: string | null }>> {
    const response = await fetch(new URL(pathname, this.#baseUrl), {
      headers: {
        accept: "application/octet-stream",
        ...(this.#token === null ? {} : { authorization: `Bearer ${this.#token}` }),
      },
    });
    if (!response.ok) {
      throw new Error(`Bridge download failed (${String(response.status)}): ${await response.text()}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentHash: response.headers.get("x-chai-artifact-sha256"),
    };
  }
}

const unwrapApiData = (payload: unknown): unknown => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Readonly<Record<string, unknown>>;
  return Object.hasOwn(record, "data") ? record.data : payload;
};
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

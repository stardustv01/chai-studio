import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface DiscoveredBridgeAttachment {
  readonly schemaVersion: "1.0.0";
  readonly instanceId: string;
  readonly pid: number;
  readonly apiOrigin: string;
  readonly projectRoot: string | null;
  readonly token: string;
  readonly capabilities: readonly string[];
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export const defaultBridgeRuntimeDirectory = (): string =>
  process.env.CHAI_STUDIO_RUNTIME_DIRECTORY ?? path.join(os.tmpdir(), "chai-studio-runtime");

export const discoverBridgeAttachment = async (
  input: {
    readonly runtimeDirectory?: string;
    readonly instanceId?: string | null;
  } = {},
): Promise<DiscoveredBridgeAttachment> => {
  const runtimeDirectory = input.runtimeDirectory ?? defaultBridgeRuntimeDirectory();
  const entries = await readdir(runtimeDirectory, { withFileTypes: true }).catch((cause: unknown) => {
    throw new Error(
      `No running Chai Studio instance was found in ${runtimeDirectory}: ${cause instanceof Error ? cause.message : "read failed"}`,
    );
  });
  const candidates: DiscoveredBridgeAttachment[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("instance-") || !entry.name.endsWith(".lock")) {
      continue;
    }
    const descriptorPath = path.join(runtimeDirectory, entry.name, "bridge-session.json");
    try {
      await assertPrivateFile(descriptorPath);
      const candidate = parseAttachment(JSON.parse(await readFile(descriptorPath, "utf8")) as unknown);
      if (
        (input.instanceId === undefined ||
          input.instanceId === null ||
          candidate.instanceId === input.instanceId) &&
        processIsAlive(candidate.pid) &&
        Date.parse(candidate.expiresAt) > Date.now()
      ) {
        candidates.push(candidate);
      }
    } catch {
      // Ignore stale, incomplete, expired, or insecure instance descriptors.
    }
  }
  candidates.sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt));
  const selected = candidates[0];
  if (selected === undefined) {
    const qualifier =
      input.instanceId === undefined || input.instanceId === null ? "" : ` matching ${input.instanceId}`;
    throw new Error(`No secure live Chai Studio bridge attachment${qualifier} was found.`);
  }
  return selected;
};

const assertPrivateFile = async (filePath: string): Promise<void> => {
  const metadata = await stat(filePath);
  if ((metadata.mode & 0o077) !== 0) throw new Error("Bridge attachment is not owner-private.");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("Bridge attachment is owned by another user.");
  }
};

const parseAttachment = (value: unknown): DiscoveredBridgeAttachment => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bridge attachment is invalid.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const requiredStrings = ["instanceId", "apiOrigin", "token", "acquiredAt", "expiresAt"] as const;
  for (const key of requiredStrings) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new Error(`Bridge attachment ${key} is invalid.`);
    }
  }
  if (
    record.schemaVersion !== "1.0.0" ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid)
  ) {
    throw new Error("Bridge attachment schema or pid is invalid.");
  }
  if (record.projectRoot !== null && typeof record.projectRoot !== "string") {
    throw new Error("Bridge attachment project root is invalid.");
  }
  if (!Array.isArray(record.capabilities) || !record.capabilities.every((item) => typeof item === "string")) {
    throw new Error("Bridge attachment capabilities are invalid.");
  }
  const origin = new URL(record.apiOrigin as string);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(origin.hostname)) {
    throw new Error("Bridge attachment origin is not loopback HTTP.");
  }
  return value as DiscoveredBridgeAttachment;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
};

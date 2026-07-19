import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StudioInstanceLease {
  readonly instanceId: string;
  readonly policy: "single-app" | "per-project";
  readonly scopeKey: string;
  readonly lockDirectory: string;
  readonly acquiredAt: string;
  release(): Promise<void>;
}

export interface StudioBridgeSessionDescriptor {
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

interface InstanceMetadata {
  readonly schemaVersion: "1.0.0";
  readonly instanceId: string;
  readonly pid: number;
  readonly policy: StudioInstanceLease["policy"];
  readonly scopeKey: string;
  readonly acquiredAt: string;
}

export const acquireStudioInstance = async (input: {
  readonly runtimeDirectory: string;
  readonly policy: StudioInstanceLease["policy"];
  readonly projectRoot?: string;
  readonly now?: () => Date;
  readonly processIsAlive?: (pid: number) => boolean;
}): Promise<StudioInstanceLease> => {
  if (input.policy === "per-project" && input.projectRoot === undefined) {
    throw new Error("Per-project instance policy requires a project root.");
  }
  const scopeKey =
    input.policy === "single-app"
      ? "application"
      : createHash("sha256")
          .update(path.resolve(input.projectRoot ?? ""))
          .digest("hex")
          .slice(0, 24);
  await mkdir(input.runtimeDirectory, { recursive: true, mode: 0o700 });
  await chmod(input.runtimeDirectory, 0o700);
  const lockDirectory = path.join(input.runtimeDirectory, `instance-${scopeKey}.lock`);
  const now = input.now ?? (() => new Date());
  const processIsAlive = input.processIsAlive ?? defaultProcessIsAlive;
  const instanceId = randomUUID();
  const metadata: InstanceMetadata = {
    schemaVersion: "1.0.0",
    instanceId,
    pid: process.pid,
    policy: input.policy,
    scopeKey,
    acquiredAt: now().toISOString(),
  };
  await acquireDirectory(lockDirectory, processIsAlive);
  await chmod(lockDirectory, 0o700);
  try {
    await writeFile(path.join(lockDirectory, "instance.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    await rm(lockDirectory, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    instanceId,
    policy: input.policy,
    scopeKey,
    lockDirectory,
    acquiredAt: metadata.acquiredAt,
    async release() {
      if (released) return;
      const current = await readMetadata(lockDirectory);
      if (current?.instanceId === instanceId) await rm(lockDirectory, { recursive: true, force: true });
      released = true;
    },
  };
};

export const publishStudioBridgeSession = async (
  lease: StudioInstanceLease,
  input: {
    readonly apiOrigin: string;
    readonly projectRoot: string | null;
    readonly token: string;
    readonly capabilities: readonly string[];
    readonly expiresAt: string;
  },
): Promise<StudioBridgeSessionDescriptor> => {
  const origin = new URL(input.apiOrigin);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(origin.hostname)) {
    throw new Error("Bridge attachment origin must be loopback HTTP.");
  }
  if (input.token.length < 32) throw new Error("Bridge attachment token is invalid.");
  const descriptor: StudioBridgeSessionDescriptor = {
    schemaVersion: "1.0.0",
    instanceId: lease.instanceId,
    pid: process.pid,
    apiOrigin: origin.origin,
    projectRoot: input.projectRoot,
    token: input.token,
    capabilities: [...new Set(input.capabilities)].sort(),
    acquiredAt: lease.acquiredAt,
    expiresAt: input.expiresAt,
  };
  await writeFile(
    path.join(lease.lockDirectory, "bridge-session.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return descriptor;
};

const acquireDirectory = async (
  lockDirectory: string,
  processIsAlive: (pid: number) => boolean,
): Promise<void> => {
  try {
    await mkdir(lockDirectory);
    return;
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const existing = await readMetadata(lockDirectory);
  if (existing !== null && processIsAlive(existing.pid)) {
    throw new Error(
      `Studio instance already owns ${existing.scopeKey} (pid ${String(existing.pid)}, instance ${existing.instanceId}).`,
    );
  }
  await rm(lockDirectory, { recursive: true, force: true });
  await mkdir(lockDirectory);
};

const readMetadata = async (lockDirectory: string): Promise<InstanceMetadata | null> => {
  try {
    const value = JSON.parse(await readFile(path.join(lockDirectory, "instance.json"), "utf8")) as unknown;
    if (
      value !== null &&
      typeof value === "object" &&
      "instanceId" in value &&
      typeof value.instanceId === "string" &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "scopeKey" in value &&
      typeof value.scopeKey === "string"
    ) {
      return value as InstanceMetadata;
    }
    return null;
  } catch {
    return null;
  }
};

const defaultProcessIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
};

const isNodeError = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

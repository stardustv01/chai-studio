import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderArtifactDescriptor, RenderArtifactMetadata } from "./contracts.js";
import { assertHash } from "./identity.js";

export interface ArtifactStoreHit {
  readonly status: "hit";
  readonly reason: "validated-strict" | "validated-portable";
  readonly artifactPath: string;
  readonly metadata: RenderArtifactMetadata;
}

export interface ArtifactStoreMiss {
  readonly status: "miss";
  readonly reason:
    "not-found" | "metadata-invalid" | "artifact-missing" | "content-corrupt" | "environment-mismatch";
  readonly quarantinedPath: string | null;
}

export type ArtifactStoreLookup = ArtifactStoreHit | ArtifactStoreMiss;

interface LastUseIndex {
  readonly schemaVersion: "1.0.0";
  readonly entries: Readonly<Record<string, Readonly<{ lastUsedAt: string; byteLength: number }>>>;
}

export class ContentAddressedArtifactStore {
  readonly #root: string;
  readonly #now: () => Date;
  readonly #checkpoint: ((point: "cache-publish") => void | Promise<void>) | undefined;
  #indexTransaction: Promise<void> = Promise.resolve();

  constructor(
    root: string,
    now: () => Date = () => new Date(),
    checkpoint?: (point: "cache-publish") => void | Promise<void>,
  ) {
    if (!path.isAbsolute(root)) throw new Error("Artifact store root must be absolute.");
    this.#root = root;
    this.#now = now;
    this.#checkpoint = checkpoint;
  }

  async publish(input: {
    readonly cacheKey: string;
    readonly sourcePath: string;
    readonly descriptor: RenderArtifactDescriptor;
    readonly dependencyManifestHash: string;
    readonly strictEnvironmentFingerprint: string;
    readonly portableEnvironmentContractHash: string | null;
    readonly producerNodeId: string;
  }): Promise<ArtifactStoreHit> {
    assertHash(input.cacheKey, "cache key");
    assertHash(input.dependencyManifestHash, "dependency manifest");
    assertHash(input.strictEnvironmentFingerprint, "strict environment");
    if (input.portableEnvironmentContractHash !== null) {
      assertHash(input.portableEnvironmentContractHash, "portable environment contract");
    }
    const source = await stat(input.sourcePath);
    if (!source.isFile()) throw new Error("Artifact publish source must be a regular file.");
    const artifactHash = await hashFile(input.sourcePath);
    const createdAt = this.#now().toISOString();
    const metadata: RenderArtifactMetadata = {
      schemaVersion: "1.0.0",
      cacheKey: input.cacheKey,
      artifactHash,
      byteLength: source.size,
      descriptor: input.descriptor,
      dependencyManifestHash: input.dependencyManifestHash,
      strictEnvironmentFingerprint: input.strictEnvironmentFingerprint,
      portableEnvironmentContractHash: input.portableEnvironmentContractHash,
      producerNodeId: input.producerNodeId,
      createdAt,
      validatedAt: createdAt,
    };
    const finalDirectory = this.#entryDirectory(input.cacheKey);
    const temporaryDirectory = path.join(this.#root, "tmp", `${input.cacheKey}-${randomUUID()}`);
    const extension = safeExtension(input.descriptor.extension);
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    try {
      await copyFile(input.sourcePath, path.join(temporaryDirectory, `artifact.${extension}`));
      await writeFile(
        path.join(temporaryDirectory, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await mkdir(path.dirname(finalDirectory), { recursive: true, mode: 0o700 });
      try {
        await rename(temporaryDirectory, finalDirectory);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        const existing = await this.lookup({
          cacheKey: input.cacheKey,
          strictEnvironmentFingerprint: input.strictEnvironmentFingerprint,
          portableEnvironmentContractHash: input.portableEnvironmentContractHash,
        });
        if (existing.status === "hit" && existing.metadata.artifactHash === artifactHash) return existing;
        throw new Error("Artifact cache key collision or invalid concurrent publish.", { cause });
      }
      await this.#checkpoint?.("cache-publish");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    await this.#touch(input.cacheKey, source.size);
    return {
      status: "hit",
      reason: "validated-strict",
      artifactPath: path.join(finalDirectory, `artifact.${extension}`),
      metadata,
    };
  }

  async lookup(input: {
    readonly cacheKey: string;
    readonly strictEnvironmentFingerprint: string;
    readonly portableEnvironmentContractHash: string | null;
  }): Promise<ArtifactStoreLookup> {
    assertHash(input.cacheKey, "cache key");
    const directory = this.#entryDirectory(input.cacheKey);
    let metadata: RenderArtifactMetadata;
    try {
      metadata = validateMetadata(
        JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as unknown,
        input.cacheKey,
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "miss", reason: "not-found", quarantinedPath: null };
      }
      return {
        status: "miss",
        reason: "metadata-invalid",
        quarantinedPath: await this.#quarantine(input.cacheKey, "metadata-invalid"),
      };
    }
    const strict = metadata.strictEnvironmentFingerprint === input.strictEnvironmentFingerprint;
    const portable =
      input.portableEnvironmentContractHash !== null &&
      metadata.portableEnvironmentContractHash === input.portableEnvironmentContractHash;
    if (!strict && !portable) {
      return { status: "miss", reason: "environment-mismatch", quarantinedPath: null };
    }
    const artifactPath = path.join(directory, `artifact.${safeExtension(metadata.descriptor.extension)}`);
    let observedHash: string;
    try {
      observedHash = await hashFile(artifactPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          status: "miss",
          reason: "artifact-missing",
          quarantinedPath: await this.#quarantine(input.cacheKey, "artifact-missing"),
        };
      }
      throw cause;
    }
    if (observedHash !== metadata.artifactHash) {
      return {
        status: "miss",
        reason: "content-corrupt",
        quarantinedPath: await this.#quarantine(input.cacheKey, "content-corrupt"),
      };
    }
    await this.#touch(input.cacheKey, metadata.byteLength);
    return {
      status: "hit",
      reason: strict ? "validated-strict" : "validated-portable",
      artifactPath,
      metadata: { ...metadata, validatedAt: this.#now().toISOString() },
    };
  }

  async cleanup(input: {
    readonly maximumBytes: number;
    readonly protectedCacheKeys: readonly string[];
  }): Promise<Readonly<{ removedKeys: readonly string[]; retainedBytes: number }>> {
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0) {
      throw new Error("Artifact cleanup byte limit is invalid.");
    }
    const protectedKeys = new Set(input.protectedCacheKeys);
    const index = await this.#readIndex();
    const ordered = Object.entries(index.entries).sort(([, left], [, right]) =>
      left.lastUsedAt.localeCompare(right.lastUsedAt, "en"),
    );
    let retainedBytes = ordered.reduce((total, [, value]) => total + value.byteLength, 0);
    const removedKeys: string[] = [];
    for (const [cacheKey, value] of ordered) {
      if (retainedBytes <= input.maximumBytes) break;
      if (protectedKeys.has(cacheKey)) continue;
      await rm(this.#entryDirectory(cacheKey), { recursive: true, force: true });
      retainedBytes -= value.byteLength;
      removedKeys.push(cacheKey);
    }
    const removed = new Set(removedKeys);
    await this.#writeIndex({
      schemaVersion: "1.0.0",
      entries: Object.fromEntries(ordered.filter(([key]) => !removed.has(key))),
    });
    return { removedKeys, retainedBytes };
  }

  #entryDirectory(cacheKey: string): string {
    return path.join(this.#root, "artifacts", cacheKey.slice(0, 2), cacheKey);
  }

  async #quarantine(cacheKey: string, reason: string): Promise<string | null> {
    const source = this.#entryDirectory(cacheKey);
    const target = path.join(
      this.#root,
      "quarantine",
      `${this.#now().toISOString().replace(/[:.]/g, "-")}-${reason}-${cacheKey}`,
    );
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await rename(source, target);
      return target;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async #touch(cacheKey: string, byteLength: number): Promise<void> {
    const transaction = this.#indexTransaction.then(async () => {
      const index = await this.#readIndex();
      await this.#writeIndex({
        schemaVersion: "1.0.0",
        entries: {
          ...index.entries,
          [cacheKey]: { lastUsedAt: this.#now().toISOString(), byteLength },
        },
      });
    });
    this.#indexTransaction = transaction.catch(() => undefined);
    await transaction;
  }

  async #readIndex(): Promise<LastUseIndex> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(this.#root, "index", "last-use.json"), "utf8"),
      );
      if (!isRecord(parsed) || parsed.schemaVersion !== "1.0.0" || !isRecord(parsed.entries)) {
        throw new Error("Artifact last-use index is invalid.");
      }
      return parsed as unknown as LastUseIndex;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: "1.0.0", entries: {} };
      }
      throw cause;
    }
  }

  async #writeIndex(index: LastUseIndex): Promise<void> {
    const directory = path.join(this.#root, "index");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, "last-use.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  }
}

const validateMetadata = (value: unknown, cacheKey: string): RenderArtifactMetadata => {
  if (!isRecord(value) || value.schemaVersion !== "1.0.0" || value.cacheKey !== cacheKey) {
    throw new Error("Artifact metadata identity is invalid.");
  }
  const metadata = value as unknown as RenderArtifactMetadata;
  assertHash(metadata.artifactHash, "artifact");
  assertHash(metadata.dependencyManifestHash, "dependency manifest");
  assertHash(metadata.strictEnvironmentFingerprint, "strict environment");
  if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 0) {
    throw new Error("Artifact metadata byte length is invalid.");
  }
  return metadata;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeExtension = (value: string): string => {
  if (!/^[a-z0-9]{1,10}$/.test(value)) throw new Error("Artifact extension is invalid.");
  return value;
};

const hashFile = async (filePath: string): Promise<string> => {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
};

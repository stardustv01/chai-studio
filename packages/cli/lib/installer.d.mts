export interface ReleaseSignature {
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly publicKeySha256: string;
  readonly value: string;
}

export interface ReleaseRecord {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly version: string;
  readonly platform: "darwin";
  readonly architecture: "arm64";
  readonly sourceCommit: string;
  readonly bundleIdentity: string;
  readonly archiveUrl: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly releaseAuthorized: boolean;
  readonly publishable: boolean;
  readonly signature: ReleaseSignature;
}

export interface ReleaseIndex {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly latest: string;
  readonly releases: readonly ReleaseRecord[];
}

export const defaultReleaseIndexUrl: string;
export const installationMarker: string;
export const defaultInstallPrefix: () => string;
export const signedReleaseBytes: (release: ReleaseRecord | Omit<ReleaseRecord, "signature">) => Buffer;
export const verifyReleaseRecord: (release: ReleaseRecord, publicKeyPem: string) => true;
export const assertSafeArchiveEntries: (listing: string) => string;
export const selectRelease: (
  index: ReleaseIndex,
  input: { version?: string; platform: string; architecture: string },
) => ReleaseRecord;
export const fetchReleaseIndex: (
  url: string,
  fetchImplementation?: typeof globalThis.fetch,
) => Promise<ReleaseIndex>;
export const doctorInstaller: (input?: {
  prefix?: string;
  platform?: string;
  architecture?: string;
}) => Promise<Record<string, unknown>>;
export const installFromRelease: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const uninstallInstalledRelease: (input?: { prefix?: string }) => Promise<Record<string, unknown>>;
export const runInstalledCommand: (input: {
  prefix?: string;
  command: string;
  arguments?: string[];
}) => Promise<Record<string, unknown>>;

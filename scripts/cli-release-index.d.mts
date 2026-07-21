import type { ReleaseIndex } from "../packages/cli/lib/installer.mjs";

export interface CliReleaseIndexInput {
  archiveReceipt: Record<string, unknown>;
  p27Manifest: Record<string, unknown>;
  finalManifest: Record<string, unknown>;
  releaseReceipt: Record<string, unknown>;
  publicKeyPem: string;
  privateKeyPem: string;
  archiveUrl: string;
  keyId: string;
}

export const buildCliReleaseIndex: (input: CliReleaseIndexInput) => ReleaseIndex;

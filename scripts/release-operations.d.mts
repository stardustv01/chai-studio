export interface ReleaseEnvironmentReport {
  readonly schemaVersion: "1.0.0";
  readonly passed: boolean;
  readonly support: "supported" | "compatible-unmeasured" | "blocked";
  readonly supportClass: "apple-m4-16gb" | null;
  readonly fingerprint: string;
  readonly identity: Readonly<Record<string, string | number>>;
  readonly checks: readonly Readonly<{ id: string; passed: boolean; observed: string }>[];
  readonly cloudAccountRequired: false;
  readonly desktopWrapperRequired: false;
}

export interface BackupManifest {
  readonly schemaVersion: "1.0.0";
  readonly kind: string;
  readonly sourceProjectName: string;
  readonly cacheExcluded: true;
  readonly deliveredArtifactsPreserved: true;
  readonly environmentFingerprint: string | null;
  readonly entries: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  readonly contentIdentity: string;
}

export const installationMarker: string;
export const backupManifestName: string;
export const collectReleaseEnvironment: (root: string) => Promise<ReleaseEnvironmentReport>;
export const installLocalRelease: (input: {
  readonly sourceRoot: string;
  readonly prefix: string;
}) => Promise<
  Readonly<{
    prefix: string;
    launcher: string;
    runtime: string;
    sourceIdentity: string;
    bundleIdentity: string;
  }>
>;
export const uninstallLocalRelease: (
  prefix: string,
) => Promise<Readonly<{ removedPrefix: string; projectsDeleted: false }>>;
export const backupProject: (input: {
  readonly source: string;
  readonly destination: string;
  readonly mode?: string;
  readonly environmentFingerprint?: string | null;
}) => Promise<BackupManifest>;
export const validateProjectBackup: (backup: string) => Promise<
  Readonly<{
    passed: boolean;
    manifest: BackupManifest;
    actualIdentity: string;
    entries: BackupManifest["entries"];
  }>
>;
export const validateBackupEnvironment: (input: {
  readonly backup: string;
  readonly currentEnvironmentFingerprint: string;
}) => Promise<
  Readonly<{
    passed: boolean;
    compatible: boolean;
    sourceEnvironmentFingerprint: string | null;
    currentEnvironmentFingerprint: string;
    status: "invalid-backup" | "environment-unknown" | "compatible" | "explicit-environment-incompatibility";
    projectRestoreAllowed: boolean;
    outputReproductionAllowed: boolean;
  }>
>;
export const restoreProjectBackup: (input: {
  readonly backup: string;
  readonly destination: string;
}) => Promise<Readonly<{ destination: string; contentIdentity: string; validated: true }>>;
export const cloneProjectBackup: (input: {
  readonly source: string;
  readonly destination: string;
  readonly environmentFingerprint?: string | null;
}) => Promise<Readonly<{ destination: string; contentIdentity: string; validated: true }>>;
export const archiveProject: (input: {
  readonly source: string;
  readonly destination: string;
  readonly environmentFingerprint?: string | null;
}) => Promise<BackupManifest>;
export const hashTree: (
  root: string,
  excludedNames?: ReadonlySet<string>,
) => Promise<readonly Readonly<{ path: string; bytes: number; sha256: string }>[]>;
export const sha256File: (file: string) => Promise<string>;
export const canonicalJson: (value: unknown) => string;

export interface ReleaseBundleEntry {
  readonly path: string;
  readonly kind: "file" | "symlink";
  readonly bytes: number;
  readonly sha256: string;
  readonly linkTarget?: string;
}

export interface ReleaseBundleMarker {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly version: string;
  readonly sourceCommit: string;
  readonly bundleIdentity: string;
  readonly selfContainedRuntime: true;
  readonly entries: readonly ReleaseBundleEntry[];
  readonly [key: string]: unknown;
}

export declare const releaseBundleMarker: string;
export declare const assertPostFreezeAuthorityChanges: (changedFiles: readonly string[]) => void;
export declare const sanitizeDeployedNodeModules: (applicationRoot: string) => Promise<void>;
export declare const assertNoHostPaths: (
  root: string,
  forbiddenPaths: readonly string[],
  options?: { readonly textOnlyPaths?: readonly string[] },
) => Promise<void>;
export declare const createReleaseBundle: (input: {
  readonly sourceRoot: string;
  readonly destination: string;
  readonly allowDirty?: boolean;
  readonly sourceCommit?: string;
}) => Promise<ReleaseBundleMarker & { readonly destination: string }>;
export declare const sealReleaseBundle: (input: {
  readonly root: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}) => Promise<ReleaseBundleMarker>;
export declare const validateReleaseBundle: (root: string) => Promise<{
  readonly passed: boolean;
  readonly requiredFilesPresent: boolean;
  readonly expectedIdentity: string;
  readonly actualIdentity: string;
  readonly marker: ReleaseBundleMarker;
  readonly entries: readonly ReleaseBundleEntry[];
}>;
export declare const hashReleaseTree: (root: string) => Promise<readonly ReleaseBundleEntry[]>;

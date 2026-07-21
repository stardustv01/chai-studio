export interface ReleaseTarget {
  readonly version: string;
  readonly channel: "release-candidate" | "stable";
  readonly releaseTag: string;
  readonly distribution: "public";
}

export const resolveReleaseTarget: (input: {
  readonly packageManifest: Readonly<Record<string, unknown>>;
  readonly releaseIdentity?: Readonly<Record<string, unknown>>;
}) => ReleaseTarget;

import releaseIdentity from "./release-identity.json" with { type: "json" };

export interface StudioReleaseIdentity {
  readonly product: "Chai Studio";
  readonly version: "1.0.0" | `1.0.0-rc.${number}`;
  readonly channel: "release-candidate" | "stable";
  readonly apiVersion: string;
  readonly schemaVersion: string;
  readonly adapterContractVersion: string;
  readonly compositorVersion: string;
  readonly engines: Readonly<Record<string, string>>;
  readonly testedBrowser: {
    readonly identity: string;
    readonly engineIdentity: string;
  };
  readonly supportClass: string;
  readonly launchModel: string;
  readonly cloudAccountRequired: boolean;
  readonly desktopWrapperRequired: boolean;
}

export const studioReleaseIdentity = releaseIdentity as StudioReleaseIdentity;

export const releaseEnvironmentFingerprint = (input: {
  readonly platform: string;
  readonly architecture: string;
  readonly cpuModel: string;
  readonly memoryGiB: number;
  readonly nodeVersion: string;
  readonly ffmpegVersion: string;
  readonly browserIdentity: string;
}): string =>
  [
    studioReleaseIdentity.version,
    input.platform,
    input.architecture,
    input.cpuModel,
    String(input.memoryGiB),
    input.nodeVersion,
    input.ffmpegVersion,
    input.browserIdentity,
  ].join("|");

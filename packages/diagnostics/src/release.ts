export const studioReleaseIdentity = {
  product: "Chai Studio",
  version: "1.0.0-rc.3",
  channel: "release-candidate",
  apiVersion: "1.0.0",
  schemaVersion: "1.0.0",
  adapterContractVersion: "1.0.0",
  compositorVersion: "render-dag-v1",
  engines: {
    remotion: "4.0.489",
    hyperframes: "0.7.58",
  },
  testedBrowser: {
    identity: "playwright-managed:chromium-1228",
    engineIdentity: "playwright-managed:chromium_headless_shell-1228",
  },
  supportClass: "apple-m4-16gb",
  launchModel: "localhost-web-server",
  cloudAccountRequired: false,
  desktopWrapperRequired: false,
} as const;

export type StudioReleaseIdentity = typeof studioReleaseIdentity;

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

import studioReleaseIdentity from "../packages/diagnostics/src/release-identity.json" with { type: "json" };

const versionPattern = /^1\.0\.0(?:-rc\.\d+)?$/u;

export const resolveReleaseTarget = ({ packageManifest, releaseIdentity = studioReleaseIdentity }) => {
  const version = packageManifest?.version;
  if (typeof version !== "string" || !versionPattern.test(version)) {
    throw new Error("Release source version is not a supported Chai Studio 1.0 candidate.");
  }
  const channel = version.includes("-rc.") ? "release-candidate" : "stable";
  if (
    releaseIdentity?.product !== "Chai Studio" ||
    releaseIdentity?.version !== version ||
    releaseIdentity?.channel !== channel
  ) {
    throw new Error("Package and diagnostics release identities do not agree.");
  }
  return { version, channel, releaseTag: `v${version}`, distribution: "public" };
};

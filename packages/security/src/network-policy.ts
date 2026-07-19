import type { ExecutableSecurityPolicy } from "./contracts.js";
import { securityIdentity } from "./identity.js";

export interface AuthorizedNetworkResource {
  readonly url: string;
  readonly domain: string;
  readonly expectedContentHash: string;
  readonly cacheNamespace: string;
  readonly policyIdentity: string;
}

export const authorizeNetworkResource = (
  policy: ExecutableSecurityPolicy,
  requestedUrl: string,
  purpose: "preview" | "final-render",
): AuthorizedNetworkResource => {
  let url: URL;
  try {
    url = new URL(requestedUrl);
  } catch {
    throw new Error("Network URL is invalid.");
  }
  if (url.protocol !== "https:" || isLocalHostname(url.hostname)) {
    throw new Error("Network policy permits only approved non-local HTTPS resources.");
  }
  const approved = policy.approvedNetworkResources.find((resource) => resource.url === url.href);
  if (policy.networkMode === "deny" || approved === undefined) {
    throw new Error("Network access is denied because the exact URL and hash are not approved.");
  }
  if (purpose === "final-render" && !/^[a-f0-9]{64}$/.test(approved.contentHash)) {
    throw new Error("Final render network resource lacks an immutable SHA-256 identity.");
  }
  return {
    url: url.href,
    domain: url.hostname,
    expectedContentHash: approved.contentHash,
    cacheNamespace: `network-${securityIdentity({ policy: policy.policyIdentity, hash: approved.contentHash })}`,
    policyIdentity: policy.policyIdentity,
  };
};

export const verifyFetchedResource = (
  authorization: AuthorizedNetworkResource,
  observedContentHash: string,
): void => {
  if (observedContentHash !== authorization.expectedContentHash) {
    throw new Error("Fetched resource hash differs from approval; the bytes cannot enter cache.");
  }
};

const isLocalHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  hostname === "127.0.0.1" ||
  hostname.endsWith(".localhost") ||
  hostname.startsWith("127.") ||
  hostname.startsWith("169.254.") ||
  hostname.startsWith("10.") ||
  hostname.startsWith("192.168.") ||
  /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);

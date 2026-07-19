import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutableSecurityPolicy } from "./contracts.js";
import { isContained } from "./path-policy.js";

export type BrowserCapabilityAttempt =
  | Readonly<{ kind: "navigate"; url: string; studioOrigin: string }>
  | Readonly<{ kind: "popup"; url: string }>
  | Readonly<{ kind: "download"; url: string }>
  | Readonly<{ kind: "external-protocol"; url: string }>
  | Readonly<{ kind: "file-url"; url: string }>
  | Readonly<{ kind: "local-service"; url: string; studioOrigin: string }>
  | Readonly<{ kind: "clipboard"; userGesture: boolean }>
  | Readonly<{ kind: "permission"; permission: string }>;

export const authorizeBrowserCapability = (
  policy: ExecutableSecurityPolicy,
  attempt: BrowserCapabilityAttempt,
): void => {
  if (attempt.kind === "clipboard") {
    if (!attempt.userGesture) throw new Error("Clipboard access requires an explicit user gesture.");
    return;
  }
  if (attempt.kind === "navigate") {
    if (new URL(attempt.url).origin !== new URL(attempt.studioOrigin).origin) {
      throw new Error("Browser navigation outside the Studio origin is forbidden.");
    }
    return;
  }
  if (attempt.kind === "local-service") {
    if (new URL(attempt.url).origin !== new URL(attempt.studioOrigin).origin) {
      throw new Error("Unapproved local-service access is forbidden.");
    }
    return;
  }
  if (attempt.kind === "file-url") {
    const candidate = realpathSync(path.resolve(fileURLToPath(attempt.url)));
    if (!policy.rootPolicies.some((root) => isContained(realpathSync(root.path), candidate))) {
      throw new Error("file URL is outside approved roots.");
    }
    return;
  }
  throw new Error(`Browser capability ${attempt.kind} is denied by policy.`);
};

export const studioSecurityHeaders = (contentSecurityPolicy: string): Readonly<Record<string, string>> => ({
  "content-security-policy": contentSecurityPolicy,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

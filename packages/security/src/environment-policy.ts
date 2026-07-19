import type { ExecutableSecurityPolicy } from "./contracts.js";
import { securityIdentity } from "./identity.js";

const forbiddenEnvironmentKey =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTHORIZATION|COOKIE|CREDENTIAL|PRIVATE|SSH|AWS|AZURE|GOOGLE|GITHUB|NPM|PNPM|HOME|USERPROFILE|TMPDIR)/i;

export interface SanitizedWorkerEnvironment {
  readonly values: Readonly<Record<string, string>>;
  readonly identityHash: string;
  readonly exposedKeys: readonly string[];
}

export const sanitizeWorkerEnvironment = (
  policy: ExecutableSecurityPolicy,
  source: Readonly<Record<string, string | undefined>>,
): SanitizedWorkerEnvironment => {
  const values: Record<string, string> = {
    LANG: policy.locale,
    LC_ALL: policy.locale,
    TZ: policy.timezone,
  };
  for (const key of policy.environmentAllowlist) {
    if (forbiddenEnvironmentKey.test(key)) continue;
    const value = source[key];
    if (value !== undefined && value.length <= 8_192 && !value.includes("\0")) values[key] = value;
  }
  const exposedKeys = Object.keys(values).sort();
  return {
    values: Object.fromEntries(exposedKeys.map((key) => [key, values[key] ?? ""])),
    identityHash: securityIdentity({ policyIdentity: policy.policyIdentity, values }),
    exposedKeys,
  };
};

import path from "node:path";

export const assertPathAllowed = ({ candidate, allowedRoots }) => {
  const resolved = path.resolve(candidate);
  const allowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!allowed) {
    const error = new Error("path is outside approved roots");
    error.code = "PATH_POLICY_VIOLATION";
    throw error;
  }
  return resolved;
};

export const sanitizeEnvironment = (environment, allowlist) =>
  Object.fromEntries(allowlist.filter((key) => Object.hasOwn(environment, key)).map((key) => [key, environment[key]]));

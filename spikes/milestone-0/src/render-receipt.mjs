import { createHash } from "node:crypto";

const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;

export const createRenderReceipt = (input) => {
  const required = ["projectId", "revisionId", "jobId", "profile", "engines", "strictEnvironment", "dependencies", "outputs", "audio", "qa", "reproduction"];
  for (const field of required) if (input[field] === undefined) throw new Error(`receipt missing ${field}`);
  const body = canonicalize({ version: 1, ...input });
  const identity = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return Object.freeze({ ...body, identity });
};

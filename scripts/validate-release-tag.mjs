import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseTarget } from "./release-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const assertReleaseTag = ({ packageManifest, refType, refName }) => {
  const target = resolveReleaseTarget({ packageManifest });
  if (refType !== "tag" || refName !== target.releaseTag) {
    throw new Error(`Protected release requires the exact Git tag ref ${target.releaseTag}.`);
  }
  return target.releaseTag;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const releaseTag = assertReleaseTag({
    packageManifest,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
  });
  console.log(JSON.stringify({ passed: true, releaseTag }, null, 2));
}

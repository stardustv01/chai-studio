import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  await access(path.join(root, ".git"));
  await promisify(execFile)("git", ["config", "core.hooksPath", ".githooks"], { cwd: root });
  console.log("Configured repository-local pre-commit validation hook.");
} catch {
  console.log(
    "No repository-local .git directory; hook install skipped without changing a parent repository.",
  );
}

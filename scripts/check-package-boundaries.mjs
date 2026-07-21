import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owners = ["packages", "apps"];
const packageEntries = [];

for (const owner of owners) {
  const ownerDirectory = path.join(root, owner);
  for (const entry of await readdir(ownerDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(ownerDirectory, entry.name);
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    packageEntries.push({ directory, manifest });
  }
}

const byName = new Map(packageEntries.map((entry) => [entry.manifest.name, entry]));
const byDirectory = new Map(packageEntries.map((entry) => [entry.directory, entry]));
const problems = [];
const graph = new Map();

for (const entry of packageEntries) {
  const declared = {
    ...entry.manifest.dependencies,
    ...entry.manifest.devDependencies,
    ...entry.manifest.peerDependencies,
  };
  const internalDependencies = Object.keys(declared).filter((name) => name.startsWith("@chai-studio/"));
  graph.set(entry.manifest.name, internalDependencies);

  for (const file of await sourceFiles(entry.directory)) {
    const source = await readFile(file, "utf8");
    for (const specifier of importsIn(source)) {
      if (specifier.startsWith("@chai-studio/")) {
        const dependencyName = packageNameForSpecifier(specifier);
        const dependencyEntry = byName.get(dependencyName);
        const subpath = specifier.slice(dependencyName.length);
        if (
          subpath.length > 0 &&
          (dependencyEntry === undefined || dependencyEntry.manifest.exports?.[`.${subpath}`] === undefined)
        ) {
          problems.push(`${file}: private package import ${specifier}`);
        }
        if (dependencyName !== entry.manifest.name && !(dependencyName in declared)) {
          problems.push(`${file}: undeclared internal dependency ${dependencyName}`);
        }
      }
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(`${entry.directory}${path.sep}`))
          problems.push(`${file}: relative import escapes package`);
      }
    }
  }

  const tsconfig = await readJsonIfPresent(path.join(entry.directory, "tsconfig.json"));
  const referencedNames = new Set(
    (tsconfig?.references ?? [])
      .map((reference) => path.resolve(entry.directory, reference.path))
      .map((directory) => byDirectory.get(directory)?.manifest.name)
      .filter(Boolean),
  );
  for (const dependency of internalDependencies) {
    if (!referencedNames.has(dependency))
      problems.push(`${entry.manifest.name}: missing TS reference for ${dependency}`);
  }
}

const visiting = new Set();
const visited = new Set();
const visit = (name, trail = []) => {
  if (visiting.has(name)) {
    problems.push(`circular dependency: ${[...trail, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dependency of graph.get(name) ?? []) {
    if (!byName.has(dependency)) problems.push(`${name}: unknown workspace dependency ${dependency}`);
    else visit(dependency, [...trail, name]);
  }
  visiting.delete(name);
  visited.add(name);
};
for (const name of graph.keys()) visit(name);

const report = {
  passed: problems.length === 0,
  packageCount: packageEntries.length,
  dependencyEdgeCount: [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0),
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

async function sourceFiles(packageDirectory) {
  const sourceDirectory = path.join(packageDirectory, "src");
  const sourceEntries = await directoryEntries(sourceDirectory);
  if (sourceEntries !== undefined) return sourceFilesIn(sourceDirectory, sourceEntries);

  const files = [];
  for (const fallback of ["bin", "lib"]) {
    const directory = path.join(packageDirectory, fallback);
    const entries = await directoryEntries(directory);
    if (entries !== undefined) files.push(...(await sourceFilesIn(directory, entries)));
  }
  return files;
}

async function sourceFilesIn(directory, entries = undefined) {
  const files = [];
  for (const entry of entries ?? (await readdir(directory, { withFileTypes: true }))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesIn(target)));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(target);
  }
  return files;
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function importsIn(source) {
  const results = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) if (match[1] !== undefined) results.push(match[1]);
  return results;
}

function packageNameForSpecifier(specifier) {
  return specifier.split("/").slice(0, 2).join("/");
}

const secretPattern = /(token|secret|password|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi;

export const redactDiagnostic = (value, { projectRoot, homeDirectory }) => {
  let output = typeof value === "string" ? value : JSON.stringify(value);
  if (projectRoot) output = output.split(projectRoot).join("<project>");
  if (homeDirectory) output = output.split(homeDirectory).join("<home>");
  return output.replace(secretPattern, (_match, label) => `${label}=<redacted>`);
};

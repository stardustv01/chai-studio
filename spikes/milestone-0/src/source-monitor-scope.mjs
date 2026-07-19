export const sourceMonitorScope = Object.freeze({
  foundation: Object.freeze(["inspect", "scrub-independent", "frame-step", "metadata", "safe-audition", "capture", "codex-context"]),
  professional: Object.freeze(["source-marks", "target-track-patching", "insert", "overwrite", "replace", "three-point-edit"]),
  ownership: Object.freeze({ foundationTransport: "isolated-source-clock", timelineTransport: "master-scheduler", edits: "validated-project-commands" }),
});

export const assertSourceCapability = (edition, capability) => {
  if (!sourceMonitorScope[edition]?.includes(capability)) throw Object.assign(new Error(`${capability} is unavailable in ${edition}`), { code: "SOURCE_SCOPE_VIOLATION" });
  return true;
};

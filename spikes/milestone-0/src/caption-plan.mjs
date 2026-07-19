import { createHash } from "node:crypto";

const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const canonical = (value) => JSON.stringify(canonicalize(value));

export const createCaptionPlan = ({ cues, fonts, dimensions, fps }) => {
  const sortedCues = [...cues].sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  for (const cue of sortedCues) {
    if (cue.startFrame < 0 || cue.endFrameExclusive <= cue.startFrame || !cue.text) throw new Error(`invalid caption cue ${cue.id}`);
  }
  const dependencies = [...fonts].sort().map((font) => ({ ...font }));
  const plan = { version: 1, dimensions, fps, cues: sortedCues, fontDependencies: dependencies, qaAnchors: sortedCues.map(({ id, startFrame, endFrameExclusive }) => ({ id, frames: [startFrame, endFrameExclusive - 1] })) };
  return Object.freeze({ ...plan, identity: createHash("sha256").update(canonical(plan)).digest("hex") });
};

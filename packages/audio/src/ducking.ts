import type { AudioAutomationLane, AudioDuckingRule } from "@chai-studio/schema";

export interface DuckingAnalysisWindow {
  readonly startFrame: string;
  readonly endFrameExclusive: string;
  readonly peakDb: number;
}

export const generateDuckingAutomation = (input: {
  readonly rule: AudioDuckingRule;
  readonly laneId: string;
  readonly keyframeIdPrefix: string;
  readonly windows: readonly DuckingAnalysisWindow[];
}): AudioAutomationLane => {
  const active = input.windows
    .filter((window) => window.peakDb >= input.rule.thresholdDb)
    .sort((left, right) => (BigInt(left.startFrame) < BigInt(right.startFrame) ? -1 : 1));
  const points = new Map<bigint, number>();
  for (const window of active) {
    const start = BigInt(window.startFrame);
    const end = BigInt(window.endFrameExclusive);
    const attack = BigInt(input.rule.attackFrames);
    const release = BigInt(input.rule.releaseFrames);
    points.set(start > attack ? start - attack : 0n, 0);
    points.set(start, input.rule.reductionDb);
    points.set(end, input.rule.reductionDb);
    points.set(end + release, 0);
  }
  return {
    id: input.laneId,
    targetKind: "bus",
    targetId: input.rule.targetBusId,
    property: "gainDb",
    keyframes: [...points.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([frame, value], index) => ({
        id: `${input.keyframeIdPrefix}:${String(index + 1).padStart(4, "0")}`,
        frame: frame.toString(10) as AudioAutomationLane["keyframes"][number]["frame"],
        value,
        interpolation: "ease-in-out",
      })),
  };
};

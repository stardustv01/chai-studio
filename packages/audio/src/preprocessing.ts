import type { AudioProcessingReference } from "@chai-studio/schema";

export interface AudioPreprocessingPlan {
  readonly reference: AudioProcessingReference;
  readonly operation: "normalize" | "noise-reduction";
  readonly preservesOriginal: true;
  readonly attributable: true;
  readonly outputRelativePath: string;
}

export const createAudioPreprocessingPlan = (input: {
  readonly referenceId: string;
  readonly kind: AudioProcessingReference["kind"];
  readonly sourceId: string;
  readonly generatedAssetId: string;
  readonly inputContentHash: string;
  readonly settingsHash: string;
  readonly outputRelativePath: string;
}): AudioPreprocessingPlan => ({
  operation: input.kind,
  preservesOriginal: true,
  attributable: true,
  outputRelativePath: input.outputRelativePath,
  reference: {
    id: input.referenceId,
    kind: input.kind,
    sourceId: input.sourceId,
    generatedAssetId: input.generatedAssetId,
    inputContentHash: input.inputContentHash,
    settingsHash: input.settingsHash,
    outputContentHash: "0".repeat(64),
    status: "planned",
  },
});

export const completeAudioPreprocessingPlan = (
  plan: AudioPreprocessingPlan,
  outputContentHash: string,
): AudioPreprocessingPlan => ({
  ...plan,
  reference: { ...plan.reference, outputContentHash, status: "ready" },
});

export interface SharedSourceAudioPolicy {
  readonly context: "program" | "source-inspection";
  readonly sourceAudio: "suppressed" | "isolated-audition";
  readonly nativeEngineAudioSuppressed: true;
  readonly connectedToMasterProgramGraph: false;
  readonly requiresExplicitAudition: boolean;
}

export const resolveSharedSourceAudioPolicy = (
  context: SharedSourceAudioPolicy["context"],
  explicitAudition = false,
): SharedSourceAudioPolicy => {
  if (context === "program" || !explicitAudition) {
    return {
      context,
      sourceAudio: "suppressed",
      nativeEngineAudioSuppressed: true,
      connectedToMasterProgramGraph: false,
      requiresExplicitAudition: context === "source-inspection",
    };
  }
  return {
    context,
    sourceAudio: "isolated-audition",
    nativeEngineAudioSuppressed: true,
    connectedToMasterProgramGraph: false,
    requiresExplicitAudition: true,
  };
};

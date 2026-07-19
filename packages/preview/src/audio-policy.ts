import { normalizePreviewRational, type PreviewRational } from "./master-clock.js";

export type PreviewAudioInteraction = "playback" | "scrub" | "frame-step" | "seek";

export interface PreviewAudioPolicy {
  readonly interaction: PreviewAudioInteraction;
  readonly programAudio: "audible" | "muted" | "silent-scrub" | "bounded-grain";
  readonly nativeEngineAudioSuppressed: true;
  readonly deterministicStretch: "none";
  readonly reason: string;
}

export const resolvePreviewAudioPolicy = (
  playRateInput: PreviewRational,
  interaction: PreviewAudioInteraction,
): PreviewAudioPolicy => {
  const playRate = normalizePreviewRational(playRateInput.numerator, playRateInput.denominator);
  if (interaction === "scrub") {
    return {
      interaction,
      programAudio: "bounded-grain",
      nativeEngineAudioSuppressed: true,
      deterministicStretch: "none",
      reason: "Scrubbing auditions a bounded grain from the shared graph without starting transport.",
    };
  }
  if (interaction === "frame-step" || interaction === "seek") {
    return {
      interaction,
      programAudio: "silent-scrub",
      nativeEngineAudioSuppressed: true,
      deterministicStretch: "none",
      reason:
        "Seek and frame-step barriers remain silent; only an explicit scrub interaction auditions a grain.",
    };
  }
  const audible = playRate.numerator === playRate.denominator && BigInt(playRate.numerator) > 0n;
  return {
    interaction,
    programAudio: audible ? "audible" : "muted",
    nativeEngineAudioSuppressed: true,
    deterministicStretch: "none",
    reason: audible
      ? "The shared program graph follows scheduler-owned +1x playback."
      : "Program audio is muted for reverse or non-unit playback; engine-native audio remains suppressed.",
  };
};

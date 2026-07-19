import type { CaptionDocument, NormalizedRational } from "@chai-studio/schema";
import { planCaptionLayout, type CaptionCollisionRegion } from "./layout.js";

export interface CaptionQaIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly cueId: string;
  readonly startFrame: string;
  readonly endFrameExclusive: string;
  readonly message: string;
}

export const evaluateCaptionQa = (input: {
  readonly captions: CaptionDocument;
  readonly fps: NormalizedRational;
  readonly width: number;
  readonly height: number;
  readonly minimumDurationFrames?: bigint;
  readonly collisionRegions?: readonly CaptionCollisionRegion[];
}): readonly CaptionQaIssue[] => {
  const issues: CaptionQaIssue[] = [];
  const styles = new Map(input.captions.styles.map((style) => [style.id, style]));
  const minimumDuration = input.minimumDurationFrames ?? 12n;
  const cuesByTrack = new Map<string, typeof input.captions.cues>();
  for (const cue of input.captions.cues) {
    const style = styles.get(cue.styleTemplateId);
    if (style === undefined) continue;
    const durationFrames = BigInt(cue.endFrameExclusive) - BigInt(cue.startFrame);
    if (durationFrames < minimumDuration) {
      issues.push(
        issue("warning", "caption.duration.short", cue, "Caption duration is below the readable minimum."),
      );
    }
    const seconds = (Number(durationFrames) * Number(input.fps.denominator)) / Number(input.fps.numerator);
    const charactersPerSecond = cue.text.replace(/\s/gu, "").length / Math.max(seconds, 1 / 1_000);
    if (charactersPerSecond > style.maxCharactersPerSecond) {
      issues.push(
        issue(
          "error",
          "caption.reading-speed.exceeded",
          cue,
          "Caption reading speed exceeds its style limit.",
        ),
      );
    }
    if (
      cue.lines.length > style.maxLines ||
      cue.lines.some((line) => line.length > style.maxCharactersPerLine)
    ) {
      issues.push(
        issue(
          "error",
          "caption.line-limit.exceeded",
          cue,
          "Caption line count or length exceeds its style limit.",
        ),
      );
    }
    try {
      const layout = planCaptionLayout({
        cue,
        style,
        width: input.width,
        height: input.height,
        ...(input.collisionRegions === undefined ? {} : { collisionRegions: input.collisionRegions }),
      });
      if (layout.collisionRegionIds.length > 0) {
        issues.push(
          issue(
            "error",
            "caption.collision",
            cue,
            `Caption collides with ${layout.collisionRegionIds.join(", ")}.`,
          ),
        );
      }
    } catch (cause: unknown) {
      issues.push(
        issue(
          "error",
          "caption.layout.invalid",
          cue,
          cause instanceof Error ? cause.message : "Caption layout failed.",
        ),
      );
    }
    const current = cuesByTrack.get(cue.trackId) ?? [];
    cuesByTrack.set(cue.trackId, [...current, cue]);
  }
  for (const cues of cuesByTrack.values()) {
    const ordered = [...cues].sort((left, right) => {
      const difference = BigInt(left.startFrame) - BigInt(right.startFrame);
      return difference < 0n ? -1 : difference > 0n ? 1 : left.id.localeCompare(right.id, "en");
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        BigInt(previous.endFrameExclusive) > BigInt(current.startFrame)
      ) {
        issues.push(issue("error", "caption.overlap", current, `Caption overlaps ${previous.id}.`));
      }
    }
  }
  return issues;
};

const issue = (
  severity: CaptionQaIssue["severity"],
  code: string,
  cue: CaptionDocument["cues"][number],
  message: string,
): CaptionQaIssue => ({
  severity,
  code,
  cueId: cue.id,
  startFrame: cue.startFrame,
  endFrameExclusive: cue.endFrameExclusive,
  message,
});

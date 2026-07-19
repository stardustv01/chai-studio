import type { CSSProperties, ImgHTMLAttributes } from "react";

export const chaiIconNames = [
  "workspace-edit",
  "workspace-media",
  "workspace-animation",
  "capture-exact",
  "render",
  "play",
  "blade-tool",
  "snap",
  "keyframe",
  "waveform",
  "qa-scan",
  "status-warning",
  "workspace-inspect",
  "workspace-deliver",
  "search",
  "project-open",
  "project-new",
  "save-state",
  "command-palette",
  "diagnostics-truth",
  "panel-collapse-expand",
  "fullscreen",
  "seek-start",
  "seek-end",
  "previous-frame",
  "next-frame",
  "pause",
  "loop-range",
  "mark-in",
  "mark-out",
  "shuttle-backward",
  "shuttle-forward",
  "playback-rate",
  "select-tool",
  "split-playhead",
  "linked-clips",
  "undo",
  "redo",
  "nudge-left",
  "nudge-right",
  "add-track",
  "delete",
  "duplicate",
  "copy",
  "paste",
  "track-lock",
  "track-mute",
  "track-solo",
  "transition",
  "timeline-marker",
  "compound-clip",
  "folder",
  "footage",
  "interview",
  "product-media",
  "audio-media",
  "graphic",
  "composition",
  "import-media",
  "relink",
  "generate-proxy",
  "validate-source",
  "media-offline",
  "duplicate-hash",
  "metadata",
  "animated-property",
  "key-add",
  "key-remove",
  "previous-key",
  "next-key",
  "curve-editor",
  "graph-value",
  "graph-speed",
  "tangent-mode",
  "interpolation-hold",
  "interpolation-bezier",
  "distribute-time",
  "gain",
  "pan",
  "fade-in",
  "fade-out",
  "crossfade",
  "sync-anchor",
  "ducking",
  "channel-map",
  "loudness",
  "transcript",
  "captions",
  "speaker-filter",
  "confidence-filter",
  "corrected",
  "compare-script",
  "caption-alignment",
  "caption-position",
  "safe-area",
  "word-highlight",
  "review-bundle",
  "feedback-request",
  "review-issue",
  "annotation",
  "visibility",
  "capture-isolated",
  "capture-before-effects",
  "capture-alpha",
  "capture-ab",
  "contact-sheet",
  "delivery-profile",
  "render-range",
  "render-frame",
  "render-timeline",
  "named-version",
  "render-queue",
  "receipt",
  "preflight",
  "approve",
  "deliver-output",
  "status-ready",
  "status-working",
  "status-info",
  "status-danger",
  "status-offline",
  "status-read-only",
  "status-conflict",
] as const;

export type ChaiIconName = (typeof chaiIconNames)[number];
export type ChaiIconSize = 14 | 16 | 20 | 24;
export type ChaiIconVariant = "dark" | "light";

const micro14Approved = new Set<ChaiIconName>([
  "play",
  "blade-tool",
  "snap",
  "keyframe",
  "waveform",
  "status-warning",
  "search",
  "fullscreen",
  "seek-start",
  "seek-end",
  "previous-frame",
  "next-frame",
  "pause",
  "mark-in",
  "mark-out",
  "shuttle-backward",
  "shuttle-forward",
  "select-tool",
  "undo",
  "redo",
  "delete",
  "folder",
  "key-add",
  "key-remove",
  "previous-key",
  "next-key",
  "gain",
  "pan",
  "fade-in",
  "fade-out",
  "crossfade",
  "visibility",
  "approve",
  "status-ready",
  "status-working",
  "status-info",
  "status-danger",
  "status-offline",
]);

export interface ChaiIconProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "height" | "src" | "width"
> {
  readonly name: ChaiIconName;
  readonly size?: ChaiIconSize;
  readonly variant?: ChaiIconVariant;
}

export const ChaiIcon = ({
  className = "",
  name,
  size = 16,
  style,
  variant = "dark",
  ...props
}: ChaiIconProps) => {
  const policy =
    size === 14 ? (micro14Approved.has(name) ? "micro-approved" : "micro-unsupported") : "approved";
  return (
    <img
      {...props}
      alt=""
      aria-hidden="true"
      className={`chai-icon ${className}`.trim()}
      data-chai-icon={name}
      data-icon-policy={policy}
      draggable={false}
      height={size}
      src={`/icons/chai/${variant}/${name}.png`}
      style={{ "--chai-icon-size": `${String(size)}px`, ...style } as CSSProperties}
      width={size}
    />
  );
};

export const isChaiIconSizeApproved = (name: ChaiIconName, size: ChaiIconSize): boolean =>
  size !== 14 || micro14Approved.has(name);

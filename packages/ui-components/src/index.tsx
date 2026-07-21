import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export const designTokens = {
  color: {
    canvas: "#06070b",
    surface: "#0b1018",
    surfaceSoft: "#0e1622",
    surfaceRaised: "#111925",
    surfaceOverlay: "#182338",
    border: "#223149",
    borderStrong: "#3a506e",
    text: "#f2f6ff",
    textMuted: "#9ba9bd",
    textFaint: "#68788f",
    accent: "#9a88ff",
    accentStrong: "#7865ff",
    accentPink: "#f47bd4",
    accentBlue: "#65a7ff",
    cyan: "#5de3f0",
    success: "#4ce6a5",
    warning: "#f4c46c",
    danger: "#ff738b",
    focus: "#c2b8ff",
  },
  space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px" },
  radius: { small: "5px", medium: "8px", large: "12px", pill: "999px" },
  type: {
    sans: '"Chai Sans", Inter, "SF Pro Text", system-ui, sans-serif',
    mono: '"SFMono-Regular", Menlo, Consolas, monospace',
    size: { caption: "11px", body: "12px", title: "14px", display: "20px" },
  },
  icon: { small: "14px", medium: "16px", large: "20px" },
  focusRing: "0 0 0 2px #06070b, 0 0 0 4px #c2b8ff",
  motion: { fast: "110ms", standard: "180ms", slow: "260ms" },
} as const;

export type UiTone = "neutral" | "info" | "ready" | "working" | "attention" | "danger";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
  readonly tone?: UiTone;
}

export const StatusPill = ({ children, className = "", tone = "neutral", ...props }: StatusPillProps) => (
  <span className={classes("ui-status-pill", `ui-tone--${tone}`, className)} {...props}>
    {children}
  </span>
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly busy?: boolean;
}

export const Button = ({
  busy = false,
  children,
  className = "",
  disabled,
  variant = "secondary",
  ...props
}: ButtonProps) => (
  <button
    className={classes("ui-button", `ui-button--${variant}`, className)}
    disabled={disabled === true || busy}
    aria-busy={busy || undefined}
    {...props}
  >
    {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
    {children}
  </button>
);

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly children: ReactNode;
}

export const IconButton = ({ children, className = "", label, ...props }: IconButtonProps) => (
  <button className={classes("ui-icon-button", className)} aria-label={label} title={label} {...props}>
    {children}
  </button>
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
  readonly tone?: UiTone;
}

export const Badge = ({ children, className = "", tone = "neutral", ...props }: BadgeProps) => (
  <span className={classes("ui-badge", `ui-tone--${tone}`, className)} {...props}>
    {children}
  </span>
);

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly message?: string;
  readonly tone?: "neutral" | "warning" | "danger";
}

export const TextField = ({
  className = "",
  id,
  label,
  message,
  tone = "neutral",
  ...props
}: TextFieldProps) => {
  const fieldId = id ?? `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  const messageId = message === undefined ? undefined : `${fieldId}-message`;
  return (
    <label className={classes("ui-field", `ui-field--${tone}`, className)} htmlFor={fieldId}>
      <span className="ui-field__label">{label}</span>
      <input id={fieldId} aria-describedby={messageId} aria-invalid={tone === "danger"} {...props} />
      {message === undefined ? null : (
        <span className="ui-field__message" id={messageId}>
          {message}
        </span>
      )}
    </label>
  );
};

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
  readonly value: number;
  readonly tone?: UiTone;
}

export const ProgressBar = ({ className = "", label, tone = "info", value, ...props }: ProgressBarProps) => {
  const boundedValue = Math.max(0, Math.min(100, value));
  return (
    <div className={classes("ui-progress", className)} {...props}>
      <div className="ui-progress__label">
        <span>{label}</span>
        <strong>{Math.round(boundedValue)}%</strong>
      </div>
      <div
        className={classes("ui-progress__track", `ui-tone--${tone}`)}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={boundedValue}
      >
        <span style={{ width: `${String(boundedValue)}%` }} />
      </div>
    </div>
  );
};

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly children: ReactNode;
  readonly tone?: UiTone;
  readonly action?: ReactNode;
}

export const Notice = ({ action, children, className = "", title, tone = "info", ...props }: NoticeProps) => (
  <div className={classes("ui-notice", `ui-tone--${tone}`, className)} role="status" {...props}>
    <span className="ui-notice__marker" aria-hidden="true" />
    <div>
      <strong>{title}</strong>
      <div className="ui-notice__body">{children}</div>
    </div>
    {action === undefined ? null : <div className="ui-notice__action">{action}</div>}
  </div>
);

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly symbol?: ReactNode;
}

export const EmptyState = ({
  action,
  className = "",
  description,
  symbol = "◇",
  title,
  ...props
}: EmptyStateProps) => (
  <div className={classes("ui-empty-state", className)} {...props}>
    <span className="ui-empty-state__symbol" aria-hidden="true">
      {symbol}
    </span>
    <strong>{title}</strong>
    <p>{description}</p>
    {action}
  </div>
);

export const uiPackageBoundary = "presentational-components-without-project-authority" as const;

const classes = (...values: readonly string[]): string => values.filter(Boolean).join(" ");

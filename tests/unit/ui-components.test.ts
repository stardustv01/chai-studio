import { describe, expect, it } from "vitest";
import {
  Button,
  designTokens,
  ProgressBar,
  StatusPill,
  TextField,
  type ButtonProps,
  type ProgressBarProps,
  type StatusPillProps,
  type TextFieldProps,
} from "../../packages/ui-components/src/index.js";
import type { ReactElement } from "react";

describe("production UI primitives", () => {
  it("exports a machine-readable dark-theme token system", () => {
    expect(designTokens.color.canvas).toBe("#080b10");
    expect(designTokens.color.focus).toBeTruthy();
    expect(designTokens.motion.standard).toMatch(/ms$/);
  });

  it("projects busy, status, validation, and progress state into primitive contracts", () => {
    const button = Button({ busy: true, children: "Render" }) as ReactElement<ButtonProps>;
    const status = StatusPill({
      tone: "attention",
      children: "Reconnecting",
    }) as ReactElement<StatusPillProps>;
    const field = TextField({
      label: "Output path",
      tone: "danger",
      message: "Choose a writable folder",
    }) as ReactElement<TextFieldProps>;
    const progress = ProgressBar({ label: "Master encode", value: 73 }) as ReactElement<ProgressBarProps>;

    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-busy"]).toBe(true);
    expect(status.props.className).toContain("ui-tone--attention");
    expect(field.props.className).toContain("ui-field--danger");
    expect(progress.props.className).toContain("ui-progress");
  });
});

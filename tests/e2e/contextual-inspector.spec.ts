import { expect, test } from "@playwright/test";

test("P15 inspector validates fields and requires explicit native-animation conversion", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const inspector = page.getByLabel("Contextual inspector");
  await expect(inspector.getByText("FutureTitle_v04", { exact: true })).toBeVisible();
  await expect(inspector.getByText("src/remotion/FutureTitle.tsx", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Validate source" })).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Proxy bake unavailable" })).toBeDisabled();
  await expect(inspector.getByLabel("Rotation", { exact: true })).toBeDisabled();
  await inspector.getByRole("button", { name: "Convert to shared" }).click();
  const rotation = inspector.getByLabel("Rotation", { exact: true });
  await expect(rotation).toBeEnabled();
  await rotation.fill("18");
  await rotation.press("Enter");
  await expect(rotation).toHaveValue("18");

  const opacity = inspector.getByLabel("Opacity", { exact: true });
  await opacity.fill("25 + 25");
  await opacity.press("Enter");
  await expect(inspector.getByRole("alert")).toContainText("expressions are not allowed");
  await opacity.fill("72");
  await opacity.press("Enter");
  await expect(inspector.getByRole("alert")).toHaveCount(0);
  await expect(inspector.getByLabel("Opacity scrub", { exact: true })).toBeVisible();
  await expect(inspector.getByText("430–760 · 330 frames", { exact: true })).toBeVisible();
});

test("P15 multi-selection exposes only shared safe properties and commits atomically", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const inspector = page.getByLabel("Contextual inspector");
  await timeline.getByRole("button", { name: /Interview A/ }).click();
  await timeline.getByRole("button", { name: /Product macro/ }).click({ modifiers: ["Shift"] });
  await expect(inspector.getByText("2 clips", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Shared safe properties · atomic edit", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Remotion native" })).toHaveCount(0);
  const opacity = inspector.getByLabel("Opacity", { exact: true });
  await opacity.fill("66");
  await opacity.press("Enter");

  await timeline.getByRole("button", { name: /Interview A/ }).click();
  await expect(inspector.getByLabel("Opacity", { exact: true })).toHaveValue("66");
  await timeline.getByRole("button", { name: /Product macro/ }).click();
  await expect(inspector.getByLabel("Opacity", { exact: true })).toHaveValue("66");
});

test("P15 curve editor navigates, copies, pastes, and changes interpolation through batch commands", async ({
  page,
}) => {
  await page.goto("/?workspace=animation");
  const editor = page.getByLabel("Deterministic keyframe curve editor");
  await expect(editor.getByText("3 keys", { exact: true })).toBeVisible();
  await expect(editor.getByRole("img", { name: "transform.opacity exact value curve" })).toBeVisible();
  await editor.getByRole("button", { name: "Next keyframe" }).click();
  await expect(editor.getByText("Current 520f", { exact: true })).toBeVisible();
  await editor.getByLabel("Keyframe value").fill("not-a-number");
  await editor.getByLabel("Keyframe value").blur();
  await expect(editor.getByRole("alert")).toContainText("finite numeric keyframe value");
  await editor.getByLabel("Keyframe value").fill("80");
  await editor.getByLabel("Keyframe value").blur();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await editor.getByLabel("Interpolation", { exact: true }).selectOption("linear");
  await editor.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(editor.getByText("6 keys", { exact: true })).toBeVisible();
});

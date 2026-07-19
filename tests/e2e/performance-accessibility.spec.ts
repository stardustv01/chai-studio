import { expect, test } from "@playwright/test";

test("honest degradation never claims dropped playback is frame-perfect", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /UI fixture · Interactive · Proxy/ }).click();
  const degradation = page.getByLabel("Honest preview degradation");
  await expect(degradation).toContainText("2 preview frames dropped");
  await expect(degradation).toContainText("not frame-perfect real time");
  await degradation.getByRole("button", { name: "Degrade safely" }).click();
  await expect(degradation).toContainText("Preview quality is reduced");
  await expect(degradation.getByRole("button", { name: "Restore one step" })).toBeEnabled();
  await expect(degradation.getByRole("button", { name: "Preview render unavailable" })).toBeDisabled();
});

test("accessibility preferences and shortcut conflict resolution remain keyboard reachable", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const accessibility = page.getByRole("region", { name: "Accessibility preferences" });
  await accessibility.getByRole("checkbox", { name: "High contrast" }).check();
  await accessibility.getByRole("checkbox", { name: "Reduced motion" }).check();
  await accessibility.getByRole("combobox", { name: "Text scale" }).selectOption("1.15");
  const app = page.locator(".studio-app");
  await expect(app).toHaveAttribute("data-high-contrast", "true");
  await expect(app).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.getByText(/Timeline summary:/)).toBeAttached();

  await page.getByRole("button", { name: "Customize shortcuts" }).click();
  const editor = page.getByRole("dialog", { name: "Shortcut editor" });
  await editor.getByRole("textbox", { name: "Search shortcuts" }).fill("Edit workspace");
  await editor.getByRole("textbox", { name: "Edit workspace key" }).fill("c");
  await editor.getByRole("checkbox", { name: "Meta" }).uncheck();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toContainText("Shortcut conflicts");
  await editor.getByRole("button", { name: "Resolve" }).click();
  await expect(editor).toContainText("conflicting commands were disabled");
  await expect(editor.getByText("0 conflicts", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Export current" }).click();
  await expect(editor.locator("textarea")).toHaveValue(/"version": 1/);
  await editor.getByRole("button", { name: "Apply profile" }).click();
  await expect(editor).toBeHidden();
});

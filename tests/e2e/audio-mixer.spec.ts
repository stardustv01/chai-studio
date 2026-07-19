import { expect, test } from "@playwright/test";

test("authoritative audio mixer edits one shared preview/final graph", async ({ page }) => {
  await page.goto("/?workspace=animation");
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");
  await page.getByRole("tab", { name: "Audio mix" }).click();
  const mixer = page.getByRole("region", { name: "Authoritative audio mixer" });
  await expect(mixer).toContainText("native engine audio suppressed");
  await expect(mixer).toContainText("Frame/sample mapping");
  await expect(mixer).toContainText("Signal meters unavailable");
  await expect(mixer).toContainText("Preview and final mix read this same graph");

  await mixer.getByLabel("Music gain").fill("-9");
  await expect(mixer.getByText("-9.0 dB")).toBeVisible();
  const musicStrip = mixer.locator(".mixer-strip").filter({ hasText: "Music" });
  await musicStrip.getByRole("button", { name: "M" }).click();
  await expect(musicStrip.getByText("Muted")).toBeVisible();
  await expect(mixer.getByRole("button", { name: "Ducking analysis unavailable" })).toBeDisabled();
  await expect(mixer).toContainText("Preview LUFS unavailable");
  await expect(mixer).toContainText("True peak measured after render");
});

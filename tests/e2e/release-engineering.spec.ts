import { expect, test } from "@playwright/test";

test("P27 About diagnostics exposes exact local release and support identity", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const identity = page.getByRole("region", { name: "Release and environment identity" });
  await identity.scrollIntoViewIfNeeded();
  await expect(identity).toContainText("1.0.0-rc.4");
  await expect(identity).toContainText("Remotion 4.0.489");
  await expect(identity).toContainText("HyperFrames 0.7.58");
  await expect(identity).toContainText("playwright-managed:chromium-1228");
  await expect(identity).toContainText("apple-m4-16gb");
  await expect(identity).toContainText("no cloud account or desktop wrapper");
});

import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("P21 Deliver exposes profiles, exact scopes, safe controls, output identity, and receipt truth", async ({
  page,
}) => {
  await page.goto("/?workspace=deliver");
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(() => document.fonts.ready);

  const queue = page
    .getByRole("region", { name: "Deliver workspace" })
    .getByLabel("Authoritative render queue");
  await expect(queue).toContainText("Sample projection");
  await expect(queue.getByRole("button", { name: "Render range" })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Render frame" })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Render timeline" })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Named version" })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Pause unavailable" })).toBeDisabled();
  await expect(queue.getByRole("button", { name: "Open" })).toBeDisabled();
  await expect(queue.getByRole("button", { name: "Reveal" })).toBeDisabled();
  await expect(queue.getByRole("button", { name: "Reveal" })).toHaveAttribute(
    "title",
    "Reveal requires the native macOS shell bridge.",
  );
  await expect(queue.getByRole("button", { name: "Compare" })).toBeDisabled();
  await expect(queue.getByText("qa warning", { exact: true })).toBeVisible();
  await expect(queue.getByText("delivered", { exact: true })).toHaveCount(0);

  await queue.getByRole("button", { name: "Render timeline" }).click();
  await expect(queue.getByRole("alert")).toContainText("UI fixture is read-only");

  const profiles = page.getByLabel("Delivery profiles");
  await expect(profiles.getByText("YouTube 1080p", { exact: true })).toBeVisible();
  await profiles.getByText("Create custom profile", { exact: true }).click();
  await expect(profiles.getByLabel("Profile name")).toBeVisible();
  await expect(profiles.getByRole("button", { name: "Save project profile" })).toBeVisible();
  await profiles.getByLabel("Width").fill("0");
  await expect(profiles.getByRole("alert")).toContainText("Width must be a positive whole number");
  await expect(profiles.getByRole("button", { name: "Save project profile" })).toBeDisabled();
  await profiles.getByLabel("Width").fill("1920");
  await profiles.getByLabel("Video codec").fill("");
  await expect(profiles.getByRole("alert")).toContainText("Video codec must be a non-empty codec identifier");
  await profiles.getByLabel("Video codec").fill("h264");
  await expect(profiles.getByRole("alert")).toHaveCount(0);

  const receipt = page.getByLabel("QA and render receipt");
  await receipt.getByText("Show immutable receipt JSON", { exact: true }).click();
  await expect(receipt).toContainText('"delivered": false');
  await page.locator(".right-panel").evaluate((panel) => {
    panel.scrollTop = 0;
  });
  await expect(page).toHaveScreenshot("p21-deliver-authority.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
});

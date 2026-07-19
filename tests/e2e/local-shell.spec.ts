import { expect, test } from "@playwright/test";

test("local shell connects and exposes explicit production truth", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chai Studio" })).toBeVisible();
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");
  await expect(page.getByRole("region", { name: "Edit workspace" })).toBeVisible();
  await expect(page.getByText("UI fixture · Interactive · Proxy")).toBeVisible();
  await expect(page.getByText("Revision 428 · 000428 · Saved")).toBeVisible();
});

test("all five workspace boundaries load without replacing the global truth bar", async ({ page }) => {
  await page.goto("/");
  for (const workspace of ["Inspect", "Media", "Animation", "Deliver"] as const) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await expect(page.getByRole("region", { name: `${workspace} workspace` })).toBeVisible();
    await expect(page.locator(".global-timecode")).toHaveText("00:00:14;24");
  }
});

test("text input suppresses editor shortcuts and render opens the real delivery setup", async ({ page }) => {
  await page.goto("/?workspace=inspect");
  const issue = page.getByLabel("New exact-frame issue");
  await issue.press("c");
  await expect(issue).toHaveValue("c");
  await expect(page.getByText("Exact capture requested")).toHaveCount(0);

  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.getByRole("region", { name: "Deliver workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New render", exact: true })).toBeVisible();
  await expect(page.getByText("Render complete", { exact: true })).toHaveCount(0);
});

test("state gallery keeps the workspace recoverable through conflicts", async ({ page }) => {
  await page.goto("/?workspace=deliver&state=conflict");
  await expect(page.getByTestId("shell-state-conflict")).toBeVisible();
  await expect(page.getByText("Revision changed before your command")).toBeVisible();
  await expect(page.getByRole("region", { name: "Deliver workspace" })).toBeVisible();
  await page.getByRole("button", { name: "View workspace safely" }).click();
  await expect(page.getByTestId("shell-state-conflict")).toHaveCount(0);
});

test("production-looking controls either execute a real transition or disclose unavailability", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: "Explore the system →" }).click();
  await expect(page.getByRole("region", { name: "Inspect workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Linked enforced" })).toBeDisabled();
  await page.getByRole("button", { name: "Animation", exact: true }).click();
  await page.getByRole("tab", { name: "Audio mix" }).click();
  await expect(page.getByRole("button", { name: "Normalization unavailable" })).toBeDisabled();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Validate source" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Proxy bake unavailable" })).toBeDisabled();

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(page.getByRole("button", { name: "Relink source" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Generate proxy" })).toBeDisabled();
  const sourceMonitor = page.getByRole("region", { name: "Professional source monitor" });
  await expect(sourceMonitor).toContainText(
    "Decoded source viewing requires an authenticated local Studio session",
  );
  await expect(sourceMonitor.getByRole("button", { name: "Capture source frame" })).toBeDisabled();
});

test("UI fixture never pretends it can open a local project folder", async ({ page }) => {
  await page.goto("/?state=empty");
  const launcher = page.getByRole("dialog", { name: "Open or create a Chai Studio project" });
  await expect(launcher).toContainText("Authenticated launcher required");
  await expect(launcher.getByLabel("Absolute .chai folder path")).toHaveCount(0);
  await launcher.getByRole("button", { name: "Continue current project" }).last().click();
  await expect(launcher).toHaveCount(0);
});

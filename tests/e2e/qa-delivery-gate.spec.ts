import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("P22 QA rules, exact review evidence, and delivery gate are truthful", async ({ page }) => {
  await page.goto("/?workspace=deliver");
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(() => document.fonts.ready);

  const receipt = page.getByLabel("QA and render receipt");
  await expect(receipt).toContainText("Central QA rules");
  await expect(receipt).toContainText("22 checks");
  await expect(receipt.getByText("Machine QA", { exact: true })).toBeVisible();
  await expect(receipt.getByText("qa warning", { exact: true }).first()).toBeVisible();
  await expect(receipt).toContainText("Output structure matches requested profile");
  await expect(receipt).toContainText("Authoritative audio measurements");
  await expect(receipt.getByText("Required visual review", { exact: true })).toBeVisible();
  await expect(receipt.getByText("8/10", { exact: true })).toBeVisible();
  await expect(receipt.getByText("first frame", { exact: true })).toBeVisible();
  await expect(receipt.getByText("phrase anchor", { exact: true })).toBeVisible();
  await expect(receipt.getByText("transition midpoint", { exact: true })).toBeVisible();
  await expect(receipt.getByRole("button", { name: "Approve exact output" })).toBeDisabled();
  await expect(receipt.getByRole("button", { name: "Record delivery" })).toBeDisabled();

  await receipt.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await expect(page).toHaveScreenshot("p22-qa-delivery-gate.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
});

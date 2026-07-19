import { expect, test, type Page } from "@playwright/test";

test("P19 review workspace exposes exact revision authority without implying approval", async ({ page }) => {
  await page.goto("/?workspace=inspect");
  await stabilizeReviewWorkspace(page);
  const desk = page.getByLabel("Authoritative review desk");
  await expect(desk).toContainText("Review desk");
  await expect(desk).toContainText("QA not evaluated");
  await expect(desk).toContainText("Opening rhythm");
  await expect(desk).toContainText("Title alignment drifts");
  await expect(desk).toContainText("No lifecycle effect");
  await expect(desk.getByRole("button", { name: "Request feedback" })).toBeDisabled();
  await expect(desk.getByRole("button", { name: "Recommend approval" })).toBeDisabled();

  const contactSheet = page.getByLabel("Exact review contact sheet");
  await expect(contactSheet).toContainText("linked frame navigation");
  await expect(contactSheet).toContainText("Parity: not claimed");
  await contactSheet.getByRole("button", { name: "Difference" }).click();
  await expect(contactSheet.getByRole("button", { name: "Difference" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await contactSheet.getByRole("button", { name: "Export capture manifest" }).click();
  await expect(contactSheet.getByRole("button", { name: "Manifest exported" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Approve$/ })).toHaveCount(0);
});

test("P19 review desk matches the approved macOS visual system", async ({ page }) => {
  await page.goto("/?workspace=inspect");
  await stabilizeReviewWorkspace(page);
  await expect(page.getByLabel("Authoritative review desk")).toBeVisible();
  await expect(page.getByLabel("Exact review contact sheet")).toBeVisible();
  await expect(page).toHaveScreenshot("p19-review-workspace.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
});

const stabilizeReviewWorkspace = async (page: Page): Promise<void> => {
  await expect(page.getByRole("region", { name: "Inspect workspace" })).toBeVisible();
  await expect(page.getByText("Selection manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Program monitor" })).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.body.getBoundingClientRect();
            resolve();
          });
        });
      }),
  );
};

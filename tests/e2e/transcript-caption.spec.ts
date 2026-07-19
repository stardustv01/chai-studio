import { expect, test } from "@playwright/test";

test("authoritative transcript and captions stay synchronized with the master timeline", async ({ page }) => {
  await page.goto("/?workspace=media");
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");

  const panel = page.getByRole("region", { name: "Authoritative transcript and captions" });
  const source = page.getByRole("region", { name: "Professional source monitor" });
  await expect(panel).toContainText("Phrase / frame linked");
  await expect(panel).toContainText("Caption QA ready for delivery preflight");

  await panel.getByLabel("Search transcript").fill("scheduler");
  await expect(
    panel.getByRole("button", { name: /One scheduler keeps every engine aligned/u }),
  ).toBeVisible();
  await expect(panel).toContainText("1 phrases");
  await panel.getByLabel("Search transcript").fill("");

  await panel.getByLabel("Filter transcript by speaker").selectOption("speaker-chai-narrator-0001");
  await panel.getByLabel("Filter transcript by confidence").selectOption("0.9");
  await expect(panel).toContainText("4 phrases");

  await panel.getByRole("button", { name: /One scheduler keeps every engine aligned/u }).click();
  await expect(source).toContainText("timeline remains frame 470");
  const transcriptText = panel.getByLabel("Transcript phrase text");
  await transcriptText.fill("One scheduler keeps every engine synchronized.");
  await transcriptText.blur();
  await expect(panel.getByLabel("Deterministic caption preview")).toContainText(
    "One scheduler keeps every engine synchronized.",
  );
  await expect(panel).toContainText("corrected");

  await panel.getByLabel("Caption safe area").fill("10");
  await expect(panel.getByLabel("Caption safe area")).toHaveValue("10");
  await panel.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(transcriptText).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Mark corrected" })).toBeDisabled();
  await expect(panel).toContainText("Transcript phrase locked");
  await panel.getByRole("button", { name: "Lock cue" }).click();
  await expect(panel.getByLabel("Caption safe area")).toBeDisabled();
  await panel.getByRole("button", { name: "Compare script" }).click();
  await expect(panel.getByText("Script comparison")).toBeVisible();

  await panel.getByRole("button", { name: "Add marker" }).click();
  await panel.getByRole("button", { name: "Split at phrase" }).click();
  await expect(page.getByText(/edit blocked/iu)).toHaveCount(0);
});

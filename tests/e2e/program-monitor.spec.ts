import { expect, test } from "@playwright/test";

test("program transport routes buttons and shortcuts through one exact clock", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const monitor = page.getByRole("region", { name: "Program monitor" });
  const timecode = monitor.locator(".monitor-time-authority code");

  await expect(timecode).toHaveText("00:00:14;24");
  await monitor.getByRole("button", { name: "Next frame" }).click();
  await expect(timecode).toHaveText("00:00:14;25");
  await monitor.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timecode).toHaveText("00:00:14;26");
  await monitor.getByRole("button", { name: "Mark timeline in" }).click();
  await monitor.getByRole("button", { name: "Toggle timeline loop" }).click();
  await expect(monitor.getByRole("button", { name: "Toggle timeline loop" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await monitor.getByLabel("Playback rate").selectOption("2");
  await expect(monitor.getByLabel("Playback rate")).toHaveValue("2");
});

test("pausing preserves the current master frame instead of returning to the playback start", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  const monitor = page.getByRole("region", { name: "Program monitor" });
  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  const startingFrame = Number(await playhead.getAttribute("aria-valuenow"));

  await monitor.getByRole("button", { name: "Play program preview" }).click();
  await expect
    .poll(async () => Number(await playhead.getAttribute("aria-valuenow")))
    .toBeGreaterThan(startingFrame + 2);
  await monitor.getByRole("button", { name: "Pause program preview" }).click();

  const pausedFrame = await playhead.getAttribute("aria-valuenow");
  expect(Number(pausedFrame)).toBeGreaterThan(startingFrame);
  await page.waitForTimeout(150);
  await expect(playhead).toHaveAttribute("aria-valuenow", pausedFrame ?? "");
  await expect(monitor.getByRole("button", { name: "Play program preview" })).toBeVisible();
});

test("capture modes fail closed without an authoritative compositor and keep overlays opt-in", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  const monitor = page.getByRole("region", { name: "Program monitor" });

  await expect(monitor.getByRole("button", { name: "Exact unavailable" })).toBeDisabled();
  await monitor.getByRole("button", { name: "Open capture modes" }).click();
  await expect(monitor.getByRole("menuitem")).toHaveCount(8);
  await expect(monitor.getByRole("checkbox", { name: "Include review overlays" })).not.toBeChecked();
  const approximateCapture = monitor.getByRole("menuitem", {
    name: "Current preview frame Fast · visibly approximate",
  });
  await expect(approximateCapture).toBeEnabled();
  for (const name of [
    "Exact fidelity frame Unavailable · authoritative compositor required",
    "Selected clip only Unavailable · authoritative compositor required",
    "Before effects Unavailable · authoritative compositor required",
    "Alpha inspection Unavailable · authoritative compositor required",
    "A/B comparison Unavailable · authoritative compositor required",
    "Review range Unavailable · authoritative compositor required",
    "Contact sheet Unavailable · authoritative compositor required",
  ]) {
    await expect(monitor.getByRole("menuitem", { name })).toBeDisabled();
  }
  await approximateCapture.click();
  await expect(page.getByText("Preview only — capture unavailable", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Launch the authenticated local Studio session before creating capture evidence."),
  ).toBeVisible();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await monitor.getByRole("button", { name: "Open capture modes" }).click();
    await expect(monitor.getByRole("menu", { name: "Capture modes" })).toBeVisible();
    await monitor.getByRole("menuitem", { name: "Current preview frame Fast · visibly approximate" }).click();
  }
  await monitor.getByRole("button", { name: "Open capture modes" }).click();
  await expect(monitor.getByRole("menu", { name: "Capture modes" })).toBeVisible();
});

test("comparison modes preserve both identities and linked monitor state", async ({ page }) => {
  await page.goto("/?workspace=inspect");
  const monitor = page.getByRole("region", { name: "Program monitor" });

  await expect(monitor.getByText("A · comparison source", { exact: false })).toBeVisible();
  await expect(monitor.getByText("B · current Revision 428 · 000428", { exact: false })).toBeVisible();
  for (const mode of ["split", "onion", "difference"] as const) {
    await monitor.getByLabel("Comparison mode").selectOption(mode);
    await expect(monitor.locator(".monitor-canvas-shell")).toHaveAttribute("data-comparison-mode", mode);
  }
  await expect(monitor.getByLabel("Comparison split position")).toHaveCount(0);
  await monitor.getByLabel("Comparison mode").selectOption("wipe");
  await expect(monitor.getByLabel("Comparison split position")).toBeVisible();
});

test("professional source monitor keeps an independent clock while edits enter revision history", async ({
  page,
}) => {
  await page.goto("/?workspace=media");
  const sourceMonitor = page.getByRole("region", { name: "Professional source monitor" });
  const globalTimecode = page.locator(".global-timecode");

  await expect(globalTimecode).toHaveText("00:00:14;24");
  await sourceMonitor.getByRole("button", { name: "Next source frame" }).click();
  await expect(sourceMonitor.getByText("Source frame 365 · timeline remains frame 444")).toBeVisible();
  await expect(globalTimecode).toHaveText("00:00:14;24");

  await sourceMonitor.getByRole("tab", { name: "Remotion" }).click();
  await sourceMonitor.getByLabel("headline").fill("Review-only title");
  await expect(sourceMonitor.getByText("Preview override", { exact: true })).toBeVisible();
  await expect(sourceMonitor.getByRole("button", { name: "Reset audition" })).toBeEnabled();
  await sourceMonitor.getByRole("button", { name: "Reset audition" }).click();
  await expect(sourceMonitor.getByText("Source defaults", { exact: true })).toBeVisible();
  await expect(globalTimecode).toHaveText("00:00:14;24");

  await expect(sourceMonitor.getByRole("button", { name: "Apply three-point edit" })).toBeVisible();
  await expect(sourceMonitor.getByRole("radio", { name: "Insert" })).toBeVisible();
  await expect(sourceMonitor).toContainText("Source transport never seeks the master timeline");

  const sourceIds: string[] = [];
  for (const kind of ["Video", "Image", "Remotion", "HyperFrames"] as const) {
    await sourceMonitor.getByRole("tab", { name: kind }).click();
    sourceIds.push(
      (await sourceMonitor
        .locator(".source-metadata div")
        .filter({ hasText: "Stable ID" })
        .locator("dd")
        .textContent()) ?? "",
    );
  }
  expect(new Set(sourceIds).size).toBe(4);
  await expect(sourceMonitor.getByRole("tablist", { name: "Source type" })).toBeVisible();
  await expect(sourceMonitor.getByRole("tablist", { name: "Source type fixture" })).toHaveCount(0);
});

test("collapsed side panels expose truthful expansion controls", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: "Collapse left panel" }).click();
  const expandLeft = page.getByRole("button", { name: "Expand left panel" });
  await expect(expandLeft).toBeVisible();
  await expandLeft.click();
  await expect(page.getByRole("button", { name: "Collapse left panel" })).toBeVisible();
  await expect(page.getByLabel("Search assets")).toBeVisible();
  await page.getByRole("button", { name: "Collapse right panel" }).click();
  const expandRight = page.getByRole("button", { name: "Expand right panel" });
  await expect(expandRight).toBeVisible();
  await expandRight.click();
  await expect(page.getByRole("button", { name: "Collapse right panel" })).toBeVisible();
  await expect(page.getByLabel("Contextual inspector")).toBeVisible();
});

test("monitor enters and exits fullscreen without losing its frame", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const monitor = page.getByRole("region", { name: "Program monitor" });

  await monitor.getByRole("button", { name: "Open fullscreen monitor" }).click();
  await expect(monitor.getByRole("button", { name: "Exit fullscreen monitor" })).toBeVisible();
  await expect(monitor.getByText("Frame 444 / 17982", { exact: true })).toBeVisible();
  await monitor.getByRole("button", { name: "Exit fullscreen monitor" }).click();
  await expect(monitor.getByRole("button", { name: "Open fullscreen monitor" })).toBeVisible();
  await expect(monitor.getByText("Frame 444 / 17982", { exact: true })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("timeline selection, search, track state, and exact range use one command surface", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });

  await expect(timeline.getByRole("button", { name: /FutureTitle_v04/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await timeline.getByRole("button", { name: /Product macro/ }).click();
  await expect(timeline.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Product macro/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await timeline.getByPlaceholder("Clip, asset, engine, warning").fill("hyperframes");
  await expect(timeline.getByText("2 matches", { exact: true })).toBeVisible();
  await expect(timeline.locator(".editor-clip")).toHaveCount(2);

  await timeline.getByRole("button", { name: "Mute MUS" }).click();
  await expect(timeline.getByRole("button", { name: "Unmute MUS" })).toHaveClass(/active/);

  await timeline.getByRole("button", { name: "Set I/O" }).click();
  await expect(timeline.getByText("I/O 444–564", { exact: true })).toBeVisible();
});

test("blade cuts at the exact pointer frame and delete remains frame-exact", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });

  await timeline.getByRole("button", { name: "B Blade" }).click();
  await timeline.getByRole("button", { name: /FutureTitle_v04/ }).click();
  await expect(timeline.getByRole("button", { name: /FutureTitle_v04/ })).toHaveCount(2);
  await expect(timeline.getByText("430–594 · 164f", { exact: true })).toHaveCount(1);
  await expect(timeline.getByText("594–760 · 166f", { exact: true })).toHaveCount(1);

  await timeline.getByRole("button", { name: "V Select" }).click();
  await timeline.getByRole("button", { name: /frames 594 to 760/ }).click();
  await timeline.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(timeline.getByText("594–760 · 166f", { exact: true })).toHaveCount(0);
});

test("playhead seeks directly and splits selected clips at its exact frame", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const playhead = timeline.getByRole("slider", { name: "Timeline playhead" });

  await timeline.locator(".timeline-ruler").click({ position: { x: 180, y: 20 } });
  await expect(playhead).toHaveAttribute("aria-valuenow", "250");
  const playheadBounds = await playhead.boundingBox();
  expect(playheadBounds).not.toBeNull();
  if (playheadBounds === null) throw new Error("Timeline playhead bounds are unavailable.");
  await page.mouse.move(
    playheadBounds.x + playheadBounds.width / 2,
    playheadBounds.y + Math.min(70, playheadBounds.height - 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    playheadBounds.x + playheadBounds.width / 2 + 72,
    playheadBounds.y + Math.min(70, playheadBounds.height - 2),
  );
  await page.mouse.up();
  await expect(playhead).toHaveAttribute("aria-valuenow", "350");
  await playhead.focus();
  await page.keyboard.press("ArrowRight");
  await expect(playhead).toHaveAttribute("aria-valuenow", "351");

  await page.reload();
  await expect(playhead).toHaveAttribute("aria-valuenow", "444");
  const splitAtPlayhead = timeline.getByRole("button", { name: "Split selected clips at playhead" });
  await expect(splitAtPlayhead).toBeEnabled();
  await splitAtPlayhead.click();
  await expect(timeline.getByText("430–444 · 14f", { exact: true })).toHaveCount(1);
  await expect(timeline.getByText("444–760 · 316f", { exact: true })).toHaveCount(1);
  await expect(timeline.getByRole("button", { name: /Undo Split clip/ })).toBeEnabled();
});

test("blade snaps to the playhead while preserving pointer-frame cutting", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await timeline.getByRole("button", { name: "B Blade" }).click();
  await timeline.getByRole("button", { name: /FutureTitle_v04/ }).hover({ position: { x: 10, y: 10 } });
  await expect(timeline.getByText(/Cut at playhead · 444f/)).toBeVisible();
});

test("timeline history and keyboard commands expose truthful labels", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });

  await expect(timeline.getByRole("button", { name: "Undo unavailable" })).toBeDisabled();
  await page.keyboard.press(",");
  await expect(timeline.getByText("429–759 · 330f", { exact: true })).toHaveCount(1);
  const undo = timeline.getByRole("button", { name: /Undo Move clip/ });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(timeline.getByText("430–760 · 330f", { exact: true })).toHaveCount(1);
  const redo = timeline.getByRole("button", { name: /Redo Move clip/ });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(timeline.getByText("429–759 · 330f", { exact: true })).toHaveCount(1);

  await page.keyboard.press("Meta+z");
  await expect(timeline.getByText("430–760 · 330f", { exact: true })).toHaveCount(1);
});

test("track commands and clip context menu share the P05 command registry", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });

  await timeline.getByRole("button", { name: "Add track", exact: true }).click();
  await expect(timeline.getByText("TRACKS 6", { exact: true })).toBeVisible();
  await timeline.getByRole("button", { name: "Remove V4" }).click();
  await expect(timeline.getByText("TRACKS 5", { exact: true })).toBeVisible();

  await timeline.getByRole("button", { name: /Data sequence/ }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(9);
  await menu.getByRole("menuitem", { name: "Link selected" }).click();
  await expect(timeline.getByRole("button", { name: /Undo Link clip/ })).toBeEnabled();

  await timeline.getByRole("button", { name: /FutureTitle_v04/ }).click();
  await expect(timeline.getByRole("button", { name: "Paste", exact: true })).toBeDisabled();
  await timeline.getByRole("button", { name: "Copy", exact: true }).click();
  await timeline.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(timeline.getByRole("button", { name: /FutureTitle_v04/ })).toHaveCount(2);
});

test("dragging beyond the track stack creates a compatible track as one undoable edit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const clip = timeline.getByRole("button", { name: /Product macro/ });
  const scroll = timeline.locator(".timeline-scroll");
  await clip.scrollIntoViewIfNeeded();
  const clipBounds = await clip.boundingBox();
  const scrollBounds = await scroll.boundingBox();
  expect(clipBounds).not.toBeNull();
  expect(scrollBounds).not.toBeNull();
  if (clipBounds === null || scrollBounds === null) throw new Error("Timeline drag bounds are unavailable.");

  await page.mouse.move(clipBounds.x + clipBounds.width / 2, clipBounds.y + clipBounds.height / 2);
  await page.mouse.down();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.mouse.move(clipBounds.x + clipBounds.width / 2, scrollBounds.y + scrollBounds.height + 12, {
    steps: 8,
  });
  await expect(timeline.locator(".timeline-action-message")).toContainText(
    "Release to create V4 and move Product macro",
  );
  await page.mouse.up();

  await expect(timeline.getByText("TRACKS 6", { exact: true })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Product macro, V4/ })).toBeVisible();
  const undo = timeline.getByRole("button", { name: /Undo Create track and move clip/ });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(timeline.getByText("TRACKS 5", { exact: true })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Product macro, V1/ })).toBeVisible();
});

test("large track stacks virtualize rows while ruler and headers stay pinned", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const addTrack = timeline.getByRole("button", { name: "Add track", exact: true });
  for (let index = 0; index < 12; index += 1) await addTrack.click();
  await expect(timeline.getByText("TRACKS 17", { exact: true })).toBeVisible();

  const scroll = timeline.locator(".timeline-scroll");
  const ruler = timeline.locator(".timeline-top-row");
  const topBefore = (await ruler.boundingBox())?.y;
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(timeline.getByRole("button", { name: "Remove V15" })).toBeVisible();
  expect(await timeline.locator(".timeline-track").count()).toBeLessThan(17);
  expect((await ruler.boundingBox())?.y).toBe(topBefore);
});

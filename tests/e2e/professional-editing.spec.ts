import { expect, test } from "@playwright/test";

test("professional roll/slip/slide controls create truthful reversible edits", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await timeline.getByRole("button", { name: /Product macro/ }).click();
  const pro = timeline.getByLabel("Professional edit controls");
  await expect(pro.getByRole("button", { name: "Roll +1" })).toBeEnabled();
  await pro.getByRole("button", { name: "Roll +1" }).click();
  await expect(timeline.getByText("430–691 · 261f", { exact: true })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Undo Roll edit/ })).toBeEnabled();
  await timeline.getByRole("button", { name: /Undo Roll edit/ }).click();
  await expect(timeline.getByText("430–690 · 260f", { exact: true })).toBeVisible();
  await pro.getByRole("button", { name: "Slip +1" }).click();
  await expect(timeline.getByRole("button", { name: /Undo Slip edit/ })).toBeEnabled();
  await pro.getByRole("button", { name: "Slide +1" }).click();
  await expect(timeline.getByText("431–691 · 260f", { exact: true })).toBeVisible();
});

test("Slide explains why a clip without contiguous neighbors cannot move", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const slide = timeline.getByLabel("Professional edit controls").getByRole("button", {
    name: "Slide +1",
  });
  await expect(slide).toBeDisabled();
  await expect(slide).toHaveAttribute(
    "title",
    "Slide requires contiguous clips on both sides of the selected clip.",
  );
});

test("professional source monitor exposes marks, target patching, and three-point commands", async ({
  page,
}) => {
  await page.goto("/?workspace=media");
  const source = page.getByRole("region", { name: "Professional source monitor" });
  await source.getByRole("button", { name: "Mark I" }).click();
  await source.getByRole("button", { name: "Mark O" }).click();
  await source.getByRole("radio", { name: "Overwrite" }).click();
  await source.getByRole("button", { name: "Apply three-point edit" }).click();
  await expect(source).toContainText(/Overwrite · derived timeline out · source clock unchanged/);
  await expect(source).toContainText("timeline remains frame 444");
});

test("advanced bridge editor never fabricates boundary QA evidence", async ({ page }) => {
  await page.goto("/?workspace=animation");
  await page.getByRole("tab", { name: "Bridge editor" }).click();
  const editor = page.getByRole("region", { name: "Advanced transition and bridge editor" });
  await expect(editor).toContainText("Blank/duplicate-frame check pending");
  await expect(editor.getByRole("button", { name: "Rendered QA required" })).toBeDisabled();
  await editor.getByLabel("Implementation").selectOption("shared");
  await editor.getByRole("button", { name: "Save bridge · QA pending" }).click();
  await expect(editor).toContainText(/Saved shared bridge · 16-frame range · boundary QA pending/);
  await expect(editor).toContainText("1 saved bridges");
});

test("expanded audio controls edit crossfade, ducking, bus automation, and sync anchors", async ({
  page,
}) => {
  await page.goto("/?workspace=animation");
  await page.getByRole("tab", { name: "Audio mix" }).click();
  const mixer = page.getByRole("region", { name: "Authoritative audio mixer" });
  await expect(mixer.getByRole("button", { name: /Crossfade/ })).toBeEnabled();
  await mixer.getByRole("button", { name: /Crossfade/ }).click();
  await mixer.getByRole("button", { name: /^Duck -8 dB$/u }).click();
  await mixer.getByRole("button", { name: "Key master bus" }).click();
  await mixer.getByRole("button", { name: "Add sync anchor" }).click();
  await expect(mixer).toContainText("graph-evaluated buses");
});

import { expect, test } from "@playwright/test";

test("first authenticated launch opens a real starter and authoritative program frame", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Chai Studio" })).toBeVisible();
  const brandMark = page.locator('.first-run-welcome__mark img[data-chai-brand="approved-v1"]');
  await expect(brandMark).toBeVisible();
  expect(
    await brandMark.evaluate((image) =>
      image instanceof HTMLImageElement
        ? { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }
        : null,
    ),
  ).toEqual({ complete: true, width: 150, height: 150 });
  await expect(page.getByText("Three locally generated PNGs")).toBeVisible();
  await expect(page.locator(".truth-status")).not.toContainText("UI fixture");
  await expect(page.locator(".project-identity")).toContainText("Chai Studio Intro");
  expect(
    await page.evaluate(() => ({
      hasToken: Boolean(window.__CHAI_STUDIO_SESSION__?.token),
      tokenInUrl: window.location.href.includes(window.__CHAI_STUDIO_SESSION__?.token ?? "missing"),
    })),
  ).toEqual({ hasToken: true, tokenInUrl: false });

  await page.getByRole("button", { name: "Start editing" }).click();
  await expect(page.getByRole("img", { name: "Authoritative program frame 0" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".editor-clip")).toHaveCount(3);
  await expect(page.locator(".program-frame figcaption")).toContainText("Rendered frame 0");
  const starterAsset = page.getByRole("button", { name: /chai-showcase-01-intro\.png/ });
  await expect(starterAsset).toContainText("image · 150f · valid");
  await expect(starterAsset).toContainText("Image");
  await expect(page.getByLabel("Contextual inspector").getByRole("textbox", { name: "Opacity" })).toHaveValue(
    "100",
  );

  const program = page.getByRole("region", { name: "Program monitor" });
  await program.getByRole("button", { name: "Play program preview" }).click();
  await expect.poll(async () => program.getByLabel("Current frame").inputValue()).not.toBe("0");
  await program.getByRole("button", { name: "Pause program preview" }).click();
  await expect
    .poll(
      async () => {
        const currentFrame = await program.getByLabel("Current frame").inputValue();
        return page.getByRole("img", { name: `Authoritative program frame ${currentFrame}` }).isVisible();
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await timeline.getByRole("button", { name: "B Blade" }).click();
  await timeline.getByRole("button", { name: "Split selected clips at playhead" }).click();
  await expect(page.locator(".editor-clip")).toHaveCount(4);
  await timeline.getByRole("button", { name: /Undo Split clip/ }).click();
  await expect(page.locator(".editor-clip")).toHaveCount(3);
  await timeline.getByRole("button", { name: "V Select" }).click();

  await page.getByRole("button", { name: "Animation", exact: true }).click();
  const curve = page.getByLabel("Deterministic keyframe curve editor");
  await expect(curve.getByLabel("Animated property")).toHaveValue("transform.opacity");
  await expect(curve.getByRole("button", { name: "Add key" })).toBeEnabled();
  await curve.getByRole("button", { name: "Add key" }).click();
  await expect(curve.getByText("1 keys", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByText("No review bundle in this revision.")).toBeVisible();
  await expect(page.getByText("Opening rhythm")).toHaveCount(0);

  const truth = await page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) return null;
    const response = await fetch(`${session.serverOrigin}/api/v1/projects/current/snapshot`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const envelope = (await response.json()) as {
      readonly data?: {
        readonly timeline?: { readonly durationFrames?: string };
        readonly assets?: {
          readonly assets?: readonly Readonly<Record<string, unknown>>[];
        };
      };
    };
    return envelope.data;
  });
  expect(truth?.timeline?.durationFrames).toBe("450");
  expect(truth?.assets?.assets).toHaveLength(3);
  expect(truth?.assets?.assets).toEqual(
    expect.arrayContaining([expect.objectContaining({ rights: "owned", validationState: "valid" })]),
  );

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const liveProgram = page.getByRole("region", { name: "Program monitor" });
  const currentFrameInput = liveProgram.getByLabel("Current frame");
  await currentFrameInput.fill("295");
  await currentFrameInput.press("Enter");
  await expect(page.getByRole("img", { name: "Authoritative program frame 295" })).toBeVisible({
    timeout: 20_000,
  });
  await liveProgram.getByRole("button", { name: "Play program preview" }).click();
  await expect
    .poll(
      async () => {
        const alt = await page.locator(".program-frame img").getAttribute("alt");
        return Number(alt?.match(/([0-9]+)$/u)?.[1] ?? "0");
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(300);
  await expect(liveProgram.getByRole("button", { name: "Pause program preview" })).toBeVisible();
  await liveProgram.getByRole("button", { name: "Pause program preview" }).click();
});

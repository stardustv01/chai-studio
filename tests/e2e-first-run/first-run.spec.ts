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

  const program = page.getByRole("region", { name: "Program monitor" });
  await program.getByRole("button", { name: "Play program preview" }).click();
  await expect.poll(async () => program.getByLabel("Current frame").inputValue()).not.toBe("0");
  await program.getByRole("button", { name: "Pause program preview" }).click();
  const currentFrame = await program.getByLabel("Current frame").inputValue();
  await expect(page.getByRole("img", { name: `Authoritative program frame ${currentFrame}` })).toBeVisible({
    timeout: 20_000,
  });

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
});

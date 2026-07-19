import { expect, test, type Page } from "@playwright/test";

const workspaces = ["edit", "inspect", "media", "animation", "deliver"] as const;
const nonHappyStates = [
  "empty",
  "loading",
  "offline",
  "reconnecting",
  "migrating",
  "recovering",
  "read-only",
  "conflict",
] as const;

test.use({ viewport: { width: 1440, height: 900 } });

test("five production workspaces match the accepted visual shell", async ({ page }) => {
  for (const workspace of workspaces) {
    const targetPage = workspace === "media" ? await page.context().newPage() : page;
    await openStableShell(targetPage, `/?workspace=${workspace}`);
    await expect(
      targetPage.getByRole("region", { name: `${capitalize(workspace)} workspace` }),
    ).toBeVisible();
    if (workspace === "media") await stabilizePaint(targetPage);
    await expect(targetPage).toHaveScreenshot(
      `p08-${workspace}-workspace.png`,
      workspace === "media" ? stablePaintScreenshotOptions : screenshotOptions,
    );
    if (targetPage !== page) await targetPage.close();
  }
});

test("every non-happy state has a stable visible recovery surface", async ({ page }) => {
  for (const state of nonHappyStates) {
    await openStableShell(page, `/?workspace=edit&state=${state}`);
    if (state === "empty") {
      await expect(page.getByRole("dialog", { name: "Open or create a Chai Studio project" })).toBeVisible();
    } else {
      await expect(page.getByTestId(`shell-state-${state}`)).toBeVisible();
    }
    await expect(page).toHaveScreenshot(`p08-state-${state}.png`, screenshotOptions);
  }
});

test("P13 program and source monitors match their reviewed modes", async ({ page }) => {
  await openStableShell(page, "/?workspace=edit");
  const editMonitor = page.getByRole("region", { name: "Program monitor" });
  await expect(editMonitor).toHaveScreenshot("p13-program-monitor-edit.png", componentScreenshotOptions);
  await editMonitor.getByRole("button", { name: "Overlays", exact: true }).click();
  await expect(editMonitor).toHaveScreenshot("p13-program-monitor-overlays.png", componentScreenshotOptions);

  await openStableShell(page, "/?workspace=inspect");
  const compareMonitor = page.getByRole("region", { name: "Program monitor" });
  await compareMonitor.getByLabel("Comparison mode").selectOption("difference");
  await expect(compareMonitor).toHaveScreenshot(
    "p13-program-monitor-difference.png",
    componentScreenshotOptions,
  );

  await openStableShell(page, "/?workspace=media");
  const sourceMonitor = page.getByRole("region", { name: "Professional source monitor" });
  await sourceMonitor.getByRole("tab", { name: "Remotion" }).click();
  await stabilizePaint(page);
  await expect(sourceMonitor).toHaveScreenshot("p13-source-monitor-remotion.png", {
    ...componentScreenshotOptions,
    animations: "allow",
  });
});

test("P14 command-driven timeline matches the reviewed edit surface", async ({ page }) => {
  await openStableShell(page, "/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await expect(timeline).toHaveScreenshot("p14-timeline-editor.png", componentScreenshotOptions);

  await timeline.getByPlaceholder("Clip, asset, engine, warning").fill("hyperframes");
  await timeline.getByRole("button", { name: "Set I/O" }).click();
  await expect(timeline).toHaveScreenshot("p14-timeline-search-range.png", componentScreenshotOptions);
});

test("P15 contextual inspector and exact curve editor match the reviewed macOS surfaces", async ({
  page,
}) => {
  await openStableShell(page, "/?workspace=edit");
  const inspector = page.getByLabel("Contextual inspector");
  await expect(inspector).toHaveScreenshot("p15-contextual-inspector.png", componentScreenshotOptions);
  await inspector.locator(".panel-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(inspector).toHaveScreenshot("p15-native-inspector-impact.png", componentScreenshotOptions);

  await openStableShell(page, "/?workspace=animation");
  const curveEditor = page.getByLabel("Deterministic keyframe curve editor");
  await expect(curveEditor).toHaveScreenshot("p15-keyframe-curve-editor.png", componentScreenshotOptions);
});

test("P16 authoritative audio graph and mixer match the reviewed macOS surface", async ({ page }) => {
  await openStableShell(page, "/?workspace=animation");
  await page.getByRole("tab", { name: "Audio mix" }).click();
  const mixer = page.getByRole("region", { name: "Authoritative audio mixer" });
  await expect(mixer).toContainText("native engine audio suppressed");
  await expect(page).toHaveScreenshot("p16-authoritative-audio-mixer.png", screenshotOptions);
});

test("P17 transcript and caption authority matches the reviewed macOS surface", async ({ page }) => {
  await openStableShell(page, "/?workspace=media");
  const panel = page.getByRole("region", { name: "Authoritative transcript and captions" });
  await expect(panel).toContainText("Phrase / frame linked");
  await expect(panel).toContainText("Live caption checks clear");
  await stabilizePaint(page);
  await expect(page).toHaveScreenshot("p17-transcript-caption-system.png", stablePaintScreenshotOptions);
});

test("P18 Codex context bridge and annotation review match the reviewed macOS surface", async ({ page }) => {
  await openStableShell(page, "/?workspace=inspect");
  const unsolicitedCaptureToast = page.getByText("Preview only — capture unavailable", { exact: true });
  await expect(unsolicitedCaptureToast).toHaveCount(0);
  await expect(page.getByText("Selection manifest", { exact: true })).toBeVisible();
  await expect(page.getByText("Capture jobs", { exact: true })).toBeVisible();
  await expect(page.getByText("Annotations", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fidelity frame" })).toBeDisabled();
  await expect(
    page.getByText("unavailable · authenticated compositor required", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Privacy only" }).check();
  await expect(unsolicitedCaptureToast).toHaveCount(0);
  await expect(page).toHaveScreenshot("p18-codex-context-bridge.png", screenshotOptions);
});

test("P25 professional editing surfaces match the reviewed macOS expansion", async ({ page }) => {
  await openStableShell(page, "/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await timeline.getByRole("button", { name: /Product macro/ }).click();
  await expect(timeline.getByLabel("Professional edit controls")).toBeVisible();
  await expect(timeline).toHaveScreenshot("p25-professional-timeline.png", componentScreenshotOptions);

  await openStableShell(page, "/?workspace=media");
  const source = page.getByRole("region", { name: "Professional source monitor" });
  await expect(source.getByText("Source marks & three-point edit")).toBeVisible();
  await expect(source).toHaveScreenshot("p25-professional-source-monitor.png", {
    ...componentScreenshotOptions,
    animations: "allow",
  });

  await openStableShell(page, "/?workspace=animation");
  await page.getByRole("tab", { name: "Bridge editor" }).click();
  const bridge = page.getByRole("region", { name: "Advanced transition and bridge editor" });
  await expect(bridge.getByText("Blank/duplicate-frame check pending")).toBeVisible();
  await expect(bridge).toHaveScreenshot("p25-advanced-bridge-editor.png", componentScreenshotOptions);
});

test("P26 degradation, accessibility, and shortcut surfaces match the reviewed macOS system", async ({
  page,
}) => {
  await openStableShell(page, "/?workspace=edit");
  await page.getByRole("button", { name: /UI fixture · Interactive · Proxy/ }).click();
  const degradation = page.getByLabel("Honest preview degradation");
  await expect(degradation).toContainText("not frame-perfect real time");
  await expect(page.locator(".truth-popover")).toHaveScreenshot(
    "p26-honest-degradation.png",
    componentScreenshotOptions,
  );

  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const accessibility = page.getByRole("region", { name: "Accessibility preferences" });
  await accessibility.getByRole("checkbox", { name: "High contrast" }).check();
  await accessibility.getByRole("checkbox", { name: "Reduced motion" }).check();
  await expect(page.locator(".diagnostics-drawer")).toHaveScreenshot(
    "p26-accessibility-diagnostics.png",
    componentScreenshotOptions,
  );
  await page.getByRole("button", { name: "Customize shortcuts" }).click();
  const editor = page.getByRole("dialog", { name: "Shortcut editor" });
  await editor.getByRole("textbox", { name: "Search shortcuts" }).fill("workspace");
  await expect(editor).toHaveScreenshot("p26-shortcut-editor.png", componentScreenshotOptions);
});

test("accessibility text scaling has reviewed full-workspace layouts", async ({ page }) => {
  await openStableShell(page, "/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  await page
    .getByRole("region", { name: "Accessibility preferences" })
    .getByLabel("Text scale")
    .selectOption("1.15");
  await page.getByRole("button", { name: "Close diagnostics" }).click();
  await stabilizePaint(page);
  await expect(page).toHaveScreenshot("p26-accessibility-text-115.png", screenshotOptions);

  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  await page
    .getByRole("region", { name: "Accessibility preferences" })
    .getByLabel("Text scale")
    .selectOption("1.3");
  await page.getByRole("button", { name: "Close diagnostics" }).click();

  for (const workspace of ["Edit", "Inspect", "Media", "Animation", "Deliver"] as const) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await stabilizePaint(page);
    const suffix = workspace === "Edit" ? "" : `-${workspace.toLowerCase()}`;
    await expect(page).toHaveScreenshot(`p26-accessibility-text-130${suffix}.png`, screenshotOptions);
  }
});

test("P27 release identity matches the reviewed local-only support surface", async ({ page }) => {
  await openStableShell(page, "/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const identity = page.getByRole("region", { name: "Release and environment identity" });
  await identity.scrollIntoViewIfNeeded();
  await expect(identity).toContainText("1.0.0-rc.3");
  await expect(identity).toHaveScreenshot("p27-release-identity.png", componentScreenshotOptions);
});

const stabilizePaint = async (page: Page): Promise<void> => {
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
  await page.waitForTimeout(500);
};

const openStableShell = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await expect(page.getByTestId("server-status")).toContainText("Local · 2026-07-15");
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(() => document.fonts.ready);
};

const capitalize = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  fullPage: true,
  maxDiffPixelRatio: 0.001,
};

const stablePaintScreenshotOptions = { ...screenshotOptions, animations: "allow" as const };

const componentScreenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.001,
};

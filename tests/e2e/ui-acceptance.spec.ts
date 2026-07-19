import { expect, test, type Locator } from "@playwright/test";

test("approved production icons load without policy or accessibility regressions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?workspace=edit");

  const brandMark = page.locator('.brand-icon img[data-chai-brand="approved-v1"]');
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveAttribute("src", "/brand/chai/v1/chai-app-icon.svg");
  expect(
    await brandMark.evaluate((image) =>
      image instanceof HTMLImageElement
        ? { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }
        : null,
    ),
  ).toEqual({ complete: true, width: 150, height: 150 });
  await expect(page.locator(".brand-icon")).toHaveText("");

  for (const workspace of ["Edit", "Inspect", "Media", "Animation", "Deliver"] as const) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    const visibleIcons = page.locator("img.chai-icon:visible");
    expect(
      await visibleIcons.count(),
      `${workspace} should expose the production icon language`,
    ).toBeGreaterThan(5);
    await expect(page.locator('img.chai-icon[data-icon-policy="micro-unsupported"]')).toHaveCount(0);
    const failures = await visibleIcons.evaluateAll((icons) =>
      icons.flatMap((icon) => {
        if (!(icon instanceof HTMLImageElement)) return ["non-image icon node"];
        return icon.complete && icon.naturalWidth === 96 && icon.naturalHeight === 96
          ? []
          : [
              `${icon.dataset.chaiIcon ?? "unknown"}:${String(icon.naturalWidth)}x${String(icon.naturalHeight)}`,
            ];
      }),
    );
    expect(failures).toEqual([]);
  }

  const iconOnlyButtonsWithoutNames = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const hasIcon = button.querySelector("img.chai-icon") !== null;
      const hasVisibleText = button.textContent.trim().length > 0;
      const name = button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "";
      return hasIcon && !hasVisibleText && name.trim().length === 0 ? [button.outerHTML] : [];
    }),
  );
  expect(iconOnlyButtonsWithoutNames).toEqual([]);
});

test("asset and project search controls perform visible filtering", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const leftPanel = page.locator(".left-panel");
  await leftPanel.getByLabel("Search assets").fill("product");
  await expect(leftPanel.getByRole("button", { name: /product_macro_02\.mov/i })).toBeVisible();
  await expect(leftPanel.getByRole("button", { name: /interview_nav\.mov/i })).toHaveCount(0);

  await leftPanel.getByRole("tab", { name: "Project", exact: true }).click();
  await expect(leftPanel.getByText("Project browser is not available in this build.")).toBeVisible();
  await leftPanel.getByRole("button", { name: "Return to Media" }).click();

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await leftPanel.getByRole("button", { name: /Project root/ }).click();
  await page.locator(".media-center").getByLabel("Search footage").fill("futuretitle");
  await expect(page.locator(".media-card")).toHaveCount(1);
  await expect(page.locator(".media-card")).toContainText("FutureTitle_v04");

  await leftPanel.getByLabel("Search project").fill("approved");
  await expect(leftPanel.getByRole("button", { name: /Approved/ })).toBeVisible();
  await expect(leftPanel.getByRole("button", { name: /Footage/ })).toHaveCount(0);
  await leftPanel.getByRole("button", { name: /Approved/ }).click();
  await expect(leftPanel.getByRole("button", { name: /Approved/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".media-card")).toHaveCount(0);
  await page.locator(".media-center").getByRole("button", { name: "Clear search" }).click();
  await expect(
    page.locator(".media-center").getByRole("status").filter({ hasText: "No assets in Approved" }),
  ).toBeVisible();
  await expect(leftPanel.getByRole("button", { name: "Add to Project browser" })).toBeEnabled();
  await leftPanel.getByLabel("Choose project media").setInputFiles({
    name: "owner-review.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("review-media"),
  });
  await expect(page.getByText("Import unavailable", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Launch the authenticated local Studio session before importing project media."),
  ).toBeVisible();
});

test("Media folders and smart collections filter the shared asset grid", async ({ page }) => {
  await page.goto("/?workspace=media");
  const leftPanel = page.locator(".left-panel");
  await leftPanel.getByRole("button", { name: /Product 1/ }).click();
  await expect(page.locator(".media-center").getByText("Product", { exact: true })).toBeVisible();
  await expect(page.locator(".media-center").getByRole("status")).toContainText(
    "Selected asset FutureTitle_v04 is outside the current filter",
  );
  await expect(page.locator(".media-card")).toHaveCount(1);
  await expect(page.locator(".media-card")).toContainText("product_macro_02.mov");
  await expect(page.locator(".media-card")).not.toContainText("interview_nav.mov");

  await leftPanel.getByRole("button", { name: /Missing \/ offline 0/ }).click();
  await expect(page.locator(".media-card")).toHaveCount(0);
  await expect(
    page.locator(".media-center").getByRole("status").filter({ hasText: "No assets in Missing / offline" }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 720 },
] as const) {
  test(`Animation controls do not overlap at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?workspace=animation");
    const toolbar = page.locator(".curve-tools");
    await expect(toolbar).toBeVisible();
    await expectNoPairwiseOverlap(toolbar.locator(":scope > *"));
    await expect(toolbar).toHaveCSS("overflow-x", "visible");
    const lowerPanel = page.locator(".lower-panel");
    const inspector = page.locator(".right-panel");
    const lowerBox = await lowerPanel.boundingBox();
    const inspectorBox = await inspector.boundingBox();
    expect(lowerBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    if (lowerBox !== null && inspectorBox !== null) {
      expect(lowerBox.x + lowerBox.width).toBeLessThanOrEqual(inspectorBox.x);
    }
  });
}

test("minimum-width header controls never overlap across workspaces", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.goto("/?workspace=edit");

  for (const workspace of ["Edit", "Inspect", "Media", "Animation", "Deliver"] as const) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await expect(page.locator(".studio-app")).toHaveAttribute("data-workspace", workspace.toLowerCase());
    const controls = page.locator(
      ".workspace-switcher button:visible, .topbar-truth > button:visible, .topbar-truth > code:visible",
    );
    await expectNoPairwiseOverlap(controls);
    const headerBox = await page.locator(".studio-topbar").boundingBox();
    const controlBoxes = await controls.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
    expect(headerBox).not.toBeNull();
    if (headerBox !== null) {
      for (const box of controlBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(headerBox.x);
        expect(box.right).toBeLessThanOrEqual(headerBox.x + headerBox.width);
      }
    }
  }
});

test("compact layout keeps every editor surface reachable below the former minimum", async ({ page }) => {
  await page.setViewportSize({ width: 369, height: 717 });
  await page.goto("/?workspace=edit");

  const app = page.locator(".studio-app");
  const compactNavigation = page.getByRole("navigation", { name: "Compact editor surfaces" });
  await expect(app).toHaveAttribute("data-compact-layout", "true");
  await expect(compactNavigation).toBeVisible();
  await expect(page.locator('.brand-icon img[data-chai-brand="approved-v1"]')).toBeVisible();
  await expect(page.getByText("Window too small for frame-accurate editing")).toHaveCount(0);

  const surfaceChecks = [
    { button: "Media", surface: "browser", visiblePanel: ".left-panel" },
    { button: "Monitor", surface: "main", visiblePanel: ".center-stage" },
    { button: "Inspector", surface: "inspector", visiblePanel: ".right-panel" },
    { button: "Timeline", surface: "timeline", visiblePanel: ".lower-panel" },
  ] as const;

  for (const check of surfaceChecks) {
    const button = compactNavigation.getByRole("button", { name: check.button, exact: true });
    await expect(button).toHaveCSS("min-height", "40px");
    await button.click();
    await expect(app).toHaveAttribute("data-compact-surface", check.surface);
    await expect(page.locator(check.visiblePanel)).toBeVisible();
    await expect(
      page.locator(".left-panel:visible, .center-stage:visible, .right-panel:visible, .lower-panel:visible"),
    ).toHaveCount(1);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(369);
});

test("portrait navigation preserves all five workspaces and their available surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?workspace=edit");
  const app = page.locator(".studio-app");

  const workspaces = [
    { workspace: "Edit", surfaces: ["Media", "Monitor", "Inspector", "Timeline"] },
    { workspace: "Inspect", surfaces: ["Review", "Monitor", "Inspector", "Contact sheet"] },
    { workspace: "Media", surfaces: ["Browser", "Assets", "Inspector", "Source"] },
    { workspace: "Animation", surfaces: ["Properties", "Monitor", "Inspector", "Curves"] },
    { workspace: "Deliver", surfaces: ["Profiles", "Queue", "Receipt"] },
  ] as const;

  for (const entry of workspaces) {
    await page.getByRole("button", { name: entry.workspace, exact: true }).click();
    await expect(app).toHaveAttribute("data-workspace", entry.workspace.toLowerCase());
    const compactNavigation = page.getByRole("navigation", { name: "Compact editor surfaces" });
    for (const surface of entry.surfaces) {
      await compactNavigation.getByRole("button", { name: surface, exact: true }).click();
      await expect(
        page.locator(
          ".left-panel:visible, .center-stage:visible, .right-panel:visible, .lower-panel:visible",
        ),
      ).toHaveCount(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }

  await expect(page.getByRole("button", { name: "Timeline", exact: true })).toBeDisabled();
});

test("Render navigation keeps the visible workspace and URL in sync", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".studio-app")).toHaveAttribute("data-workspace", "deliver");
  await expect(page).toHaveURL(/workspace=deliver/u);
  await page.reload();
  await expect(page.locator(".studio-app")).toHaveAttribute("data-workspace", "deliver");
});

test("program monitor context menu exposes only truthful capabilities and supports Escape", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  const monitor = page.getByRole("region", { name: "Program monitor" });
  await monitor.locator(".monitor-viewport").click({ button: "right", position: { x: 40, y: 40 } });
  const menu = page.getByRole("menu", { name: "Program monitor context menu" });
  await expect(menu.getByRole("menuitem", { name: "Fit composition" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Capture exact frame" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Fit composition" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Toggle safe zones" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(monitor).toBeFocused();
});

test("primary workspace controls are fully reachable at the declared minimum viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.goto("/?workspace=edit");

  const controls = [
    {
      workspace: "Edit",
      locators: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByLabel("Timeline zoom"),
      ],
    },
    {
      workspace: "Inspect",
      locators: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByRole("button", { name: "Recommend approval" }),
      ],
    },
    {
      workspace: "Media",
      locators: [
        page.getByRole("button", { name: "Previous source frame" }),
        page.getByRole("button", { name: "Next source frame" }),
        page.getByRole("radio", { name: "Insert" }),
      ],
    },
    {
      workspace: "Animation",
      locators: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByRole("button", { name: "Overlays" }),
        page.getByRole("button", { name: "Go to timeline start" }),
      ],
    },
    {
      workspace: "Deliver",
      locators: [page.getByRole("button", { name: "Named version" })],
    },
  ] as const;

  for (const entry of controls) {
    await page.getByRole("button", { name: entry.workspace, exact: true }).click();
    for (const control of entry.locators) await expectFullyInsideClippingAncestors(control);
  }
});

test("modal focus, interactive Space, compact navigation, and separator keys are accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?workspace=edit");
  const projectButton = page.locator(".project-identity");
  await projectButton.focus();
  await projectButton.click();
  const diagnostics = page.getByRole("dialog", { name: "Truth, recovery, and performance" });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Close diagnostics" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(diagnostics).toHaveCount(0);
  await expect(projectButton).toBeFocused();

  const editWorkspace = page.getByRole("button", { name: "Edit", exact: true });
  await editWorkspace.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play program preview" })).toBeVisible();

  const leftSeparator = page.getByRole("separator", { name: "Resize left browser panel" });
  await leftSeparator.focus();
  const before = Number(await leftSeparator.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect(leftSeparator).toHaveAttribute("aria-valuenow", String(before + 8));
  await page.keyboard.press("Home");
  await expect(leftSeparator).toHaveAttribute("aria-valuenow", "180");

  await page.setViewportSize({ width: 1180, height: 719 });
  const compactNavigation = page.getByRole("navigation", { name: "Compact editor surfaces" });
  await expect(page.locator(".studio-app")).toHaveAttribute("data-compact-layout", "true");
  await expect(compactNavigation).toBeVisible();
  await expect(leftSeparator).toBeHidden();
  const mediaSurface = compactNavigation.getByRole("button", { name: "Media", exact: true });
  await mediaSurface.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".studio-app")).toHaveAttribute("data-compact-surface", "browser");
  await expect(page.locator(".left-panel")).toBeVisible();
});

test("timeline clips support keyboard movement and APG menu navigation without frame-announcement floods", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const clip = timeline.getByRole("button", { name: /Interview A, V1, frames 48 to 430/ }).first();
  await clip.focus();
  await page.keyboard.press("Enter");
  await expect(clip).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(timeline.getByRole("button", { name: /Interview A, V1, frames 47 to 429/ })).toBeVisible();
  const moved = timeline.getByRole("button", { name: /Interview A, V1, frames 47 to 429/ });
  await moved.focus();
  await page.keyboard.press("ArrowRight");
  const restored = timeline.getByRole("button", { name: /Interview A, V1, frames 48 to 430/ }).first();
  await restored.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Interview A clip actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Group selected" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(restored).toBeFocused();

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Rename clip…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const renameDialog = page.getByRole("dialog", { name: "Rename clip" });
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel("Clip name").fill("Interview A renamed");
  await renameDialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(timeline.getByRole("button", { name: /Interview A renamed, V1/ })).toBeVisible();
  await timeline.getByRole("button", { name: /Undo Rename clip/ }).click();
  await expect(timeline.getByRole("button", { name: /Interview A, V1, frames 48 to 430/ })).toBeVisible();

  const summary = timeline.locator("p[role='status']").first();
  const beforePlayback = await summary.textContent();
  const currentFrameInput = page.getByRole("textbox", { name: "Current frame" });
  const startingFrame = Number(await currentFrameInput.inputValue());
  await page.getByRole("button", { name: "Play program preview" }).click();
  await expect.poll(async () => Number(await currentFrameInput.inputValue())).toBeGreaterThan(startingFrame);
  const advancedFrame = Number(await currentFrameInput.inputValue());
  expect(await summary.textContent()).toBe(beforePlayback);
  await page.getByRole("button", { name: "Pause program preview" }).click();
  await expect(page.getByRole("button", { name: "Play program preview" })).toBeVisible();
  const pausedFrame = Number(await currentFrameInput.inputValue());
  expect(pausedFrame).toBeGreaterThanOrEqual(advancedFrame);
  expect(pausedFrame).toBeGreaterThan(startingFrame);
  await expect(timeline.getByRole("slider", { name: "Timeline playhead" })).toHaveAttribute(
    "aria-valuenow",
    String(pausedFrame),
  );
  await page.waitForTimeout(100);
  await expect(currentFrameInput).toHaveValue(String(pausedFrame));

  const trackControlSizes = await timeline
    .locator(".timeline-track-header > button:not(.track-title):visible")
    .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect()));
  expect(trackControlSizes.length).toBeGreaterThan(0);
  for (const size of trackControlSizes) {
    expect(size.width).toBeGreaterThanOrEqual(28);
    expect(size.height).toBeGreaterThanOrEqual(28);
  }
});

test("Deliver receipt title clears the panel-collapse control", async ({ page }) => {
  await page.goto("/?workspace=deliver");
  const collapse = page.locator(".right-panel .panel-collapse");
  const title = page.locator(".delivery-receipt > .panel-titlebar strong");
  const collapseBox = await collapse.boundingBox();
  const titleBox = await title.boundingBox();
  expect(collapseBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (collapseBox === null || titleBox === null) return;
  expect(titleBox.x).toBeGreaterThanOrEqual(collapseBox.x + collapseBox.width + 6);
});

test("accessibility text scaling is single-pass rather than recursive", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const drawer = page.getByRole("dialog", { name: "Truth, recovery, and performance" });
  const baselineScrollHeight = await drawer.evaluate((element) => element.scrollHeight);
  await page
    .getByRole("region", { name: "Accessibility preferences" })
    .getByLabel("Text scale")
    .selectOption("1.3");
  const app = page.locator(".studio-app");
  const toolbarButton = page.getByRole("button", { name: "Render", exact: true });
  const rootFontSize = await app.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const buttonFontSize = await toolbarButton.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(rootFontSize).toBeCloseTo(15.6, 1);
  expect(buttonFontSize).toBeLessThanOrEqual(18.5);
  const badgeFontSizes = await page
    .locator(".ui-badge:visible")
    .evaluateAll((badges) => badges.map((badge) => Number.parseFloat(getComputedStyle(badge).fontSize)));
  expect(badgeFontSizes.length).toBeGreaterThan(0);
  for (const fontSize of badgeFontSizes) expect(fontSize).toBeGreaterThanOrEqual(14.2);
  const scrollHeight = await drawer.evaluate((element) => element.scrollHeight);
  expect(scrollHeight / baselineScrollHeight).toBeLessThanOrEqual(1.35);
  expect(scrollHeight).toBeLessThan(1800);
});

test("all workspaces preserve reachable primary controls at 130 percent text across supported sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const diagnostics = page.getByRole("dialog", { name: "Truth, recovery, and performance" });
  await diagnostics.getByLabel("Text scale").selectOption("1.3");
  await diagnostics.getByRole("button", { name: "Close diagnostics" }).click();

  const workspaceChecks = [
    {
      workspace: "Edit",
      controls: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByLabel("Timeline zoom"),
      ],
    },
    {
      workspace: "Inspect",
      controls: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByRole("button", { name: "Recommend approval" }),
      ],
    },
    {
      workspace: "Media",
      controls: [
        page.getByRole("button", { name: "Previous source frame" }),
        page.getByRole("radio", { name: "Insert" }),
      ],
    },
    {
      workspace: "Animation",
      controls: [
        page.getByRole("button", { name: "Open fullscreen monitor" }),
        page.getByRole("button", { name: "Go to timeline start" }),
      ],
    },
    { workspace: "Deliver", controls: [page.getByRole("button", { name: "Named version" })] },
  ] as const;

  for (const viewport of [
    { width: 1180, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const entry of workspaceChecks) {
      await page.getByRole("button", { name: entry.workspace, exact: true }).click();
      await expect(page.locator(".studio-app")).toHaveAttribute(
        "data-workspace",
        entry.workspace.toLowerCase(),
      );
      await expectNoPairwiseOverlap(
        page.locator(
          ".workspace-switcher button:visible, .topbar-truth > button:visible, .topbar-truth > code:visible",
        ),
      );
      for (const control of entry.controls) await expectFullyInsideClippingAncestors(control);
      expect(await page.locator(".studio-app").evaluate((app) => app.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    }
  }
});

test("monitor transport and capture controls meet the 28 pixel action floor", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const boxes = await page
    .locator(".monitor-transport > button:visible, .monitor-capture-anchor > button:visible")
    .evaluateAll((controls) =>
      controls.map((control) => {
        const box = control.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          label: control.getAttribute("aria-label") ?? control.textContent,
        };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.label} width`).toBeGreaterThanOrEqual(28);
    expect(box.height, `${box.label} height`).toBeGreaterThanOrEqual(28);
  }
});

test("Inspector reset controls meet the 28 pixel action floor", async ({ page }) => {
  await page.goto("/?workspace=edit");
  const boxes = await page
    .locator('.inspector-field__control > button[aria-label^="Reset "]:visible')
    .evaluateAll((controls) =>
      controls.map((control) => {
        const box = control.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          label: control.getAttribute("aria-label"),
        };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.label} width`).toBeGreaterThanOrEqual(28);
    expect(box.height, `${box.label} height`).toBeGreaterThanOrEqual(28);
  }
});

const expectNoPairwiseOverlap = async (controls: Locator): Promise<void> => {
  const boxes = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  );
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      if (left === undefined || right === undefined) continue;
      const intersects =
        left.left < right.right &&
        left.right > right.left &&
        left.top < right.bottom &&
        left.bottom > right.top;
      expect(intersects, `controls ${String(leftIndex)} and ${String(rightIndex)} overlap`).toBe(false);
    }
  }
};

const expectFullyInsideClippingAncestors = async (control: Locator): Promise<void> => {
  await expect(control).toBeVisible();
  const result = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const failures: string[] = [];
    if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) {
      failures.push("viewport");
    }
    let ancestor = element.parentElement;
    while (ancestor !== null) {
      const style = getComputedStyle(ancestor);
      const clipsX = ["auto", "hidden", "clip", "scroll"].includes(style.overflowX);
      const clipsY = ["auto", "hidden", "clip", "scroll"].includes(style.overflowY);
      if (clipsX || clipsY) {
        const ancestorBox = ancestor.getBoundingClientRect();
        if (clipsX && (box.left < ancestorBox.left - 0.5 || box.right > ancestorBox.right + 0.5)) {
          failures.push(`${ancestor.className || ancestor.tagName}:x`);
        }
        if (clipsY && (box.top < ancestorBox.top - 0.5 || box.bottom > ancestorBox.bottom + 0.5)) {
          failures.push(`${ancestor.className || ancestor.tagName}:y`);
        }
      }
      ancestor = ancestor.parentElement;
    }
    return {
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      failures,
      label: (element.getAttribute("aria-label") ?? element.textContent.trim()) || element.tagName,
    };
  });
  expect(result.failures, `${result.label} at ${JSON.stringify(result.box)}`).toEqual([]);
};

import { expect, test } from "@playwright/test";

const workspaceNames = ["Edit", "Inspect", "Media", "Animation", "Deliver"] as const;

test("all workspace surfaces expose named controls and unique document identities", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.goto("/?workspace=edit");

  for (const workspace of workspaceNames) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await expect(page.locator(".studio-app")).toHaveAttribute("data-workspace", workspace.toLowerCase());
    await expect(page.getByRole("complementary", { name: `${workspace} browser panel` })).toBeVisible();
    await expect(page.getByRole("complementary", { name: `${workspace} inspector panel` })).toBeVisible();
    const audit = await page.evaluate(() => {
      const visible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      };
      const accessibleName = (element: HTMLElement): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledText = labelledBy
          ?.split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent.trim() ?? "")
          .join(" ")
          .trim();
        const explicitLabel =
          "labels" in element && element.labels instanceof NodeList
            ? [...element.labels].map((label) => label.textContent?.trim() ?? "").join(" ")
            : "";
        return (
          [
            element.getAttribute("aria-label")?.trim() ?? "",
            labelledText ?? "",
            explicitLabel,
            element.closest("label")?.textContent.trim() ?? "",
            element.textContent.trim(),
            element.getAttribute("title")?.trim() ?? "",
          ].find((value) => value.length > 0) ?? ""
        );
      };
      const selector = [
        "button",
        "a[href]",
        "input:not([type='hidden'])",
        "select",
        "textarea",
        "summary",
        "[role='button']",
        "[role='menuitem']",
        "[role='radio']",
        "[role='slider']",
        "[role='tab']",
      ].join(",");
      const unnamed = [...document.querySelectorAll(selector)]
        .filter(visible)
        .filter((element) => accessibleName(element) === "")
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
      const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
      const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      const hiddenInteractive = [...document.querySelectorAll<HTMLElement>("[aria-hidden='true']")]
        .filter(visible)
        .flatMap((container) => [...container.querySelectorAll<HTMLElement>(selector)].filter(visible))
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
      return { unnamed, duplicateIds, hiddenInteractive };
    });

    expect(audit.unnamed, `${workspace} unnamed controls`).toEqual([]);
    expect(audit.duplicateIds, `${workspace} duplicate IDs`).toEqual([]);
    expect(audit.hiddenInteractive, `${workspace} interactive controls inside aria-hidden content`).toEqual(
      [],
    );
  }
});

test("production truth and panel tabs expose complete keyboard semantics", async ({ page }) => {
  await page.goto("/?workspace=edit");

  const truthTrigger = page.locator(".truth-status");
  await expect(truthTrigger).toHaveAttribute("aria-expanded", "false");
  await truthTrigger.click();
  await expect(truthTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Persistent production truth" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Persistent production truth" })).toHaveCount(0);
  await expect(truthTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(truthTrigger).toBeFocused();

  const tabs = page.getByRole("tablist", { name: "Media views" });
  const mediaTab = tabs.getByRole("tab", { name: "Media", exact: true });
  const projectTab = tabs.getByRole("tab", { name: "Project", exact: true });
  const transcriptTab = tabs.getByRole("tab", { name: "Transcript", exact: true });
  await expect(mediaTab).toHaveAttribute("tabindex", "0");
  await expect(projectTab).toHaveAttribute("tabindex", "-1");
  await mediaTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(projectTab).toBeFocused();
  await expect(projectTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(transcriptTab).toBeFocused();
  await expect(transcriptTab).toHaveAttribute("aria-selected", "true");
});

test("non-happy shell states announce status and blocking failures", async ({ page }) => {
  await page.goto("/?workspace=edit&state=loading");
  await expect(page.getByTestId("shell-state-loading")).toHaveAttribute("role", "status");

  await page.goto("/?workspace=edit&state=offline");
  await expect(page.getByTestId("shell-state-offline")).toHaveAttribute("role", "alert");
});

test("high-contrast mode preserves strong core text contrast", async ({ page }) => {
  await page.goto("/?workspace=edit");
  await page.getByRole("button", { name: /Launch Film.*Revision 428/ }).click();
  const diagnostics = page.getByRole("dialog", { name: "Truth, recovery, and performance" });
  await diagnostics.getByRole("checkbox", { name: "High contrast" }).check();
  await diagnostics.getByRole("button", { name: "Close diagnostics" }).click();

  const ratios = await page.locator(".studio-app").evaluate((app) => {
    const parse = (color: string): readonly [number, number, number] => {
      const normalized = color.trim();
      if (/^#[\da-f]{3}$/iu.test(normalized)) {
        return [1, 2, 3].map((index) => {
          const digit = normalized.charAt(index);
          return Number.parseInt(`${digit}${digit}`, 16);
        }) as [number, number, number];
      }
      if (/^#[\da-f]{6}$/iu.test(normalized)) {
        return [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16)) as [
          number,
          number,
          number,
        ];
      }
      const match = color
        .match(/\d+(?:\.\d+)?/gu)
        ?.slice(0, 3)
        .map(Number);
      if (match?.length !== 3) throw new Error(`Unsupported computed color: ${color}`);
      return [match[0] ?? 0, match[1] ?? 0, match[2] ?? 0];
    };
    const luminance = ([red, green, blue]: readonly [number, number, number]): number => {
      const [r, g, b] = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const contrast = (foreground: string, background: string): number => {
      const light = luminance(parse(foreground));
      const dark = luminance(parse(background));
      return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    };
    const style = getComputedStyle(app);
    return {
      primary: contrast(style.getPropertyValue("--text"), style.getPropertyValue("--surface")),
      secondary: contrast(style.getPropertyValue("--muted"), style.getPropertyValue("--surface")),
    };
  });

  expect(ratios.primary).toBeGreaterThanOrEqual(7);
  expect(ratios.secondary).toBeGreaterThanOrEqual(4.5);
});

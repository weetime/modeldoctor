import { expect, test } from "@playwright/test";

const PALETTES = ["slate", "aurora", "indigo", "plum", "clay"] as const;
const MODES = ["light", "dark"] as const;

for (const palette of PALETTES) {
  for (const mode of MODES) {
    test(`theme: palette=${palette} mode=${mode}`, async ({ page }) => {
      await page.addInitScript(
        ([p, m]) => {
          window.localStorage.setItem(
            "md.theme.v1",
            JSON.stringify({ state: { mode: m, palette: p }, version: 0 }),
          );
        },
        [palette, mode] as const,
      );

      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      if (mode === "dark") {
        await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/);
      }

      // Confirm body picked up palette tokens.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.trim());
      expect(bg.length).toBeGreaterThan(0);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      await expect(page).toHaveScreenshot(`theme-${palette}-${mode}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
}

import { type Page, expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

/**
 * Per-mode smoke for the Playground. We don't actually invoke any LLM —
 * the test connection's API key is a placeholder, so a real call would
 * 401 from the upstream. Instead we verify each mode's page mounts, the
 * PageHeader title renders, and the shared <ConnectionPicker> appears.
 *
 * If the routes/pages start crashing on import (lazy-load or schema
 * regression), these specs catch it before the user does.
 */

const MODES = [
  { path: "/playground/chat", title: /chat/i },
  { path: "/playground/image", title: /image/i },
  { path: "/playground/audio", title: /audio/i },
  { path: "/playground/embeddings", title: /embeddings/i },
  { path: "/playground/rerank", title: /rerank/i },
] as const;

for (const mode of MODES) {
  test(`mounts: ${mode.path}`, async ({ page }) => {
    await assertNoConsoleErrors(page, async () => {
      await page.goto(mode.path);
      // PageHeader h1 is the source of truth per CLAUDE.md "Page layout
      // convention". Wait up to 10s in case lazy-loaded chunks hydrate slow.
      await expect(page.getByRole("heading", { level: 1, name: mode.title })).toBeVisible({
        timeout: 10_000,
      });
      // ConnectionPicker is reused across every Playground mode that
      // requires a backend connection. Verifying it mounts here pins
      // that contract — if a future refactor breaks the import, every
      // mode's smoke fails at once instead of one at a time in prod.
      await expect(page.getByRole("combobox").first()).toBeVisible();
    });
  });
}

test("playground/ redirects to /playground/chat", async ({ page }) => {
  await page.goto("/playground");
  await expect(page).toHaveURL(/\/playground\/chat$/, { timeout: 5_000 });
});

test("chat compare page mounts", async ({ page }) => {
  // The chat-compare route is its own page (ChatComparePage); h1 is "Compare".
  await assertNoConsoleErrors(page, async () => {
    await page.goto("/playground/chat/compare");
    await expect(page.getByRole("heading", { level: 1, name: /compare/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

/**
 * Assert no React error-boundary / uncaught-error console messages were
 * emitted while running `fn`. Catches "white screen" regressions where
 * the URL navigates but the page actually crashed in render.
 *
 * Filter known noisy messages: Vite dev "connecting…", React DevTools
 * suggestion, and the missing-Description Radix dialog warning we get
 * from ConnectionDialog (separate cleanup).
 */
async function assertNoConsoleErrors(page: Page, fn: () => Promise<void>): Promise<void> {
  const errors: string[] = [];
  const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      text.includes("[vite] connecting") ||
      text.includes("React DevTools") ||
      text.includes("Missing `Description`")
    ) {
      return;
    }
    errors.push(text);
  };
  page.on("console", onConsole);
  try {
    await fn();
  } finally {
    page.off("console", onConsole);
  }
  expect(errors, `console errors: ${errors.join("\n")}`).toEqual([]);
}

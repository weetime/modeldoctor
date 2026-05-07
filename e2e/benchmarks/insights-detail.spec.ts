import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("redirects from legacy /benchmarks/reports/:id to /insights/:id", async ({ page }) => {
  await page.goto("/benchmarks/reports/does-not-exist?range=7d");
  await expect(page).toHaveURL(/\/insights\/does-not-exist(\?|$)/, { timeout: 10_000 });
  // Search params should be preserved across the redirect.
  await expect(page).toHaveURL(/range=7d/);
});

test("notFound state for unknown connectionId", async ({ page }) => {
  await page.goto("/insights/does-not-exist");
  await expect(
    page.getByText(/Connection not found or deleted|连接不存在或已删除/i),
  ).toBeVisible({ timeout: 10_000 });
});

test("range picker writes ?range=7d to URL on a connection with no runs", async ({ page }) => {
  // Create a connection via browser fetch. Auth is a Bearer token in a
  // zustand store; mint one via /api/auth/refresh (HttpOnly cookie set by
  // registerAndLogin) and use it as Authorization for the create request.
  const created = await page.evaluate(async () => {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!refreshRes.ok) throw new Error(`refresh failed: ${refreshRes.status}`);
    const { accessToken } = (await refreshRes.json()) as { accessToken: string };
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: "e2e-empty",
        baseUrl: "http://example.test:8000",
        apiKey: "sk-e2e",
        model: "test-model",
        category: "chat",
      }),
    });
    if (!res.ok) throw new Error(`create connection failed: ${res.status} ${await res.text()}`);
    return res.json();
  });
  const connectionId = (created as { id: string }).id;

  await page.goto(`/insights/${connectionId}`);
  // Connection name is in the page header.
  await expect(page.getByText("e2e-empty")).toBeVisible({ timeout: 10_000 });

  // Range picker is the second combobox in the header rightSlot
  // (the first is ProfileSelector). Range labels are hardcoded zh-CN.
  const comboboxes = page.getByRole("combobox");
  await comboboxes.nth(1).click();
  await page.getByRole("option", { name: "近 7 天" }).click();
  await expect(page).toHaveURL(/\?range=7d/);
});

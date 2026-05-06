import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("detail page: notFound state for unknown connectionId", async ({ page }) => {
  await page.goto("/benchmarks/reports/does-not-exist");
  await expect(page.getByText(/Connection not found|未找到此连接/i)).toBeVisible({
    timeout: 10_000,
  });
});

test("detail page: empty state + URL-persisted range when connection has no runs", async ({
  page,
}) => {
  // Create a connection via browser fetch. Auth is a Bearer token kept in
  // a zustand store (not localStorage / not a cookie) — so we mint a fresh
  // access token via the HttpOnly refresh cookie set by registerAndLogin,
  // then use it as Authorization for the create request.
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

  await page.goto(`/benchmarks/reports/${connectionId}`);
  await expect(page.getByText("e2e-empty")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(/No benchmarks within|选定时间范围内没有基准测试/i),
  ).toBeVisible();

  // Range picker writes ?range=7d to the URL.
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Last 7 days|近 7 天/i }).click();
  await expect(page).toHaveURL(/\?range=7d/);
});

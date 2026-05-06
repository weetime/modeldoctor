import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("Endpoint Reports: empty state on fresh DB; sidebar entry navigates here", async ({
  page,
}) => {
  // Direct nav: fresh DB has zero benchmarks → empty state.
  await page.goto("/benchmarks/reports");
  await expect(page.getByText(/No report data|暂无报告数据/i)).toBeVisible({
    timeout: 10_000,
  });

  // Sidebar entry navigates here.
  await page.getByRole("link", { name: /Endpoint Reports|端点报告/i }).click();
  await expect(page).toHaveURL(/\/benchmarks\/reports$/);
});

test("/benchmarks/compare without ids redirects to /benchmarks/inference", async ({ page }) => {
  await page.goto("/benchmarks/compare");
  await expect(page).toHaveURL(/\/benchmarks\/inference$/);
});

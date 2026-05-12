import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers/auth";
import { resetTestDb } from "./helpers/db";

/**
 * NOTE — scope of this spec.
 *
 * The full save→detail flow needs two seeded Benchmark rows with
 * `summaryMetrics` populated. The public POST /api/benchmarks endpoint
 * goes through the K8s job runner which is unavailable in the e2e env
 * (same constraint that gates `benchmarks.spec.ts`), so we cannot drive
 * the Compare→Save dialog without reaching into Prisma directly.
 *
 * The full happy-path is covered by `apps/api/test/e2e/saved-compares.e2e-spec.ts`
 * (HTTP-level Vitest + supertest). This Playwright spec covers the
 * routing/layout/i18n integration that those API tests cannot:
 *
 *   1. /benchmarks/compare/saved renders for an authenticated user with
 *      the right page title and EmptyState (no saved compares yet).
 *   2. The route is gated by ProtectedRoute (anonymous → /login).
 *
 * If a Prisma-based seeder is introduced later (e.g. exported from
 * `e2e/helpers/seeders.ts`), upgrade this to the full
 * Compare→SaveCompareDialog→detail flow per the original task plan.
 */

test.beforeEach(() => {
  resetTestDb();
});

test("saved compares list renders empty state for a fresh authenticated user", async ({
  page,
}) => {
  await registerAndLogin(page);
  await page.goto("/benchmarks/compare/saved");

  await expect(
    page.getByRole("heading", { level: 1, name: /已保存的对比|Saved comparisons/i }),
  ).toBeVisible();

  // EmptyState text — substring match because the full string includes
  // a trailing instruction sentence ("在 Compare 页点击「保存对比」开始。").
  await expect(page.getByText(/尚无已保存的对比|No saved comparisons yet/i)).toBeVisible({
    timeout: 10_000,
  });
});

test("saved compares route is gated — anonymous visit redirects to /login", async ({ page }) => {
  await page.goto("/benchmarks/compare/saved");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/login/);
});

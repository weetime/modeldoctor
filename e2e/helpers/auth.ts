import type { Page } from "@playwright/test";

export interface TestUser {
  email: string;
  password: string;
}

/**
 * Register a fresh user via the UI and wait for the auto-redirect to
 * `/benchmarks`. Returns the credentials so the caller can log out and
 * back in if the spec needs that.
 *
 * Why UI (and not POST /api/auth/register): the goal of these specs is
 * exercising the full integration. A direct API setup would skip the
 * cookie/refresh wiring that production traffic depends on.
 */
export async function registerAndLogin(
  page: Page,
  user: Partial<TestUser> = {},
): Promise<TestUser> {
  const email =
    user.email ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = user.password ?? "test-pass-1234";

  await page.goto("/register");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/benchmarks/, { timeout: 15_000 });
  return { email, password };
}

import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(() => {
  resetTestDb();
});

test("register → auto-login → land on benchmarks page", async ({ page }) => {
  const { email } = await registerAndLogin(page);
  // Sidebar shows the user's email when logged in.
  await expect(page.getByText(email)).toBeVisible();
});

test("required-field validation: empty email + password blocks submit", async ({ page }) => {
  await page.goto("/register");

  // Both labels render the red asterisk (LoginPage / RegisterPage post-#99).
  const stars = page.locator("label span", { hasText: "*" });
  await expect(stars).toHaveCount(2);

  await page.getByRole("button", { name: /create account/i }).click();
  // Stay on /register (no redirect to /benchmarks).
  await expect(page).toHaveURL(/\/register/);
});

test("logout from sidebar then login again", async ({ page }) => {
  const { email, password } = await registerAndLogin(page);

  // Logout button — sidebar exposes a logout affordance for the current user.
  await page.getByRole("button", { name: /logout|sign out|登出|退出/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

  // Login round-trip with the same credentials.
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/benchmarks/, { timeout: 10_000 });
  await expect(page.getByText(email)).toBeVisible();
});

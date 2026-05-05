import { expect, test } from "@playwright/test";
import { resetTestDb } from "./helpers/db";

test.beforeEach(() => {
  resetTestDb();
});

test("register → auto-login → land on benchmarks page", async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "test-pass-1234";

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  // Auto-redirect to /benchmarks on successful register (RegisterPage.tsx:36).
  await expect(page).toHaveURL(/\/benchmarks/, { timeout: 15_000 });

  // Sidebar shows the user's email when logged in.
  await expect(page.getByText(email)).toBeVisible();
});

test("required-field validation: empty email + password blocks submit", async ({ page }) => {
  await page.goto("/register");

  // Both labels render the red asterisk (LoginPage / RegisterPage post-#99).
  const stars = page.locator("label span", { hasText: "*" });
  await expect(stars).toHaveCount(2);

  // Click submit without typing anything — RHF is in onSubmit mode here, so
  // it surfaces validation errors but does NOT navigate.
  await page.getByRole("button", { name: /create account/i }).click();

  // Stay on /register (no redirect to /benchmarks).
  await expect(page).toHaveURL(/\/register/);
});

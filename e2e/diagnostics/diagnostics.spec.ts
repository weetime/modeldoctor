import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("/diagnostics — endpoint health probe page mounts", async ({ page }) => {
  await page.goto("/diagnostics");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The shared <EndpointPicker> wraps <ConnectionPicker> on this page —
  // saved-connection dropdown + 粘贴 cURL button.
  await expect(page.getByRole("combobox").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /paste cURL|粘贴 cURL/i })).toBeVisible();
});

test("/debug — request-debug page mounts", async ({ page }) => {
  await page.goto("/debug");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Method + URL row are the page's primary controls.
  await expect(page.getByRole("combobox").first()).toBeVisible();
});

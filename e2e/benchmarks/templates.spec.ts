import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";
import { clickSave } from "../helpers/form";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("create template via page → appears in list", async ({ page }) => {
  await page.goto("/benchmark-templates");
  await expect(page.getByRole("heading", { level: 1, name: /template/i })).toBeVisible();

  // Click "New template" — actions.new in benchmark-templates.json.
  await page
    .getByRole("button", { name: /^new template$/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/benchmark-templates\/new/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: /new template/i })).toBeVisible();

  // Required asterisk on Name field.
  await expect(page.locator("label span", { hasText: "*" }).first()).toBeVisible();

  // Fill — Tab from Name to blur it (triggers onTouched validation).
  const name = page.getByLabel(/^Name/i);
  await name.fill("e2e-template-1");
  await name.press("Tab");
  await page.getByLabel(/description/i).fill("Smoke test template");

  // Default scenario "inference" + tool "guidellm" + datasetName "random"
  // requires Input/Output tokens (no default in guidellmParamDefaults).
  await page.getByLabel(/input tokens/i).fill("128");
  await page.getByLabel(/output tokens/i).fill("128");

  await clickSave(page);

  // Redirects to /benchmark-templates?scenario=inference on success.
  await expect(page).toHaveURL(/\/benchmark-templates\?scenario=/, { timeout: 10_000 });
  await expect(page.getByRole("link", { name: /e2e-template-1/ })).toBeVisible();
});

test("edit template → name updates in list", async ({ page }) => {
  // Seed via create flow (also fills tokens — see comment in first test).
  await page.goto("/benchmark-templates/new");
  const name = page.getByLabel(/^Name/i);
  await name.fill("e2e-edit-before");
  await name.press("Tab");
  await page.getByLabel(/input tokens/i).fill("128");
  await page.getByLabel(/output tokens/i).fill("128");
  await clickSave(page);
  await expect(page).toHaveURL(/\/benchmark-templates\?scenario=/, { timeout: 10_000 });
  const beforeCard = page.getByRole("link", { name: /e2e-edit-before/ });
  await expect(beforeCard).toBeVisible();

  // Open the template's edit page (TemplateCard click navigates to
  // /benchmark-templates/<id>).
  await beforeCard.click();
  await expect(page).toHaveURL(/\/benchmark-templates\/[a-z0-9-]+/i, { timeout: 10_000 });

  // Update name + Tab to blur, then Save.
  const editName = page.getByLabel(/^Name/i);
  await editName.fill("e2e-edit-after");
  await editName.press("Tab");
  await clickSave(page);

  // Edit page stays put on save; navigate back to list to verify.
  await page.goto("/benchmark-templates");
  await expect(page.getByRole("link", { name: /e2e-edit-after/ })).toBeVisible({
    timeout: 10_000,
  });
});

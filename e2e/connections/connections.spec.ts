import { expect, type Page, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

async function createConnection(page: Page, name: string, port = 8000): Promise<void> {
  // Toolbar's primary "New connection" button is the first one in the DOM
  // when both empty-state and toolbar buttons are present.
  await page
    .getByRole("button", { name: /new connection/i })
    .first()
    .click();
  // Wait for the dialog to mount.
  await expect(page.getByRole("dialog")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/i).fill(name);
  await dialog.getByRole("combobox", { name: /category/i }).click();
  await page.getByRole("option", { name: /chat/i }).click();
  await dialog.getByLabel(/api base url/i).fill(`http://example.test:${port}`);
  await dialog.getByLabel(/api key/i).fill(`sk-${name}`);
  await dialog.getByLabel(/^Model/i).fill(`${name}-model`);
  await dialog.getByRole("button", { name: /^save$/i }).click();
  // Dialog dismisses on success.
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
}

test("create connection via dialog → appears in list", async ({ page }) => {
  await page.goto("/connections");
  // Use h1 specifically — sidebar renders the same text as a nav link, which
  // gets accessible-name'd as "heading" too in some browsers.
  await expect(page.getByRole("heading", { level: 1, name: /connections/i })).toBeVisible();

  // Open the create dialog.
  await page
    .getByRole("button", { name: /new connection/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Required-field smoke: 5 red asterisks (name, category, apiBaseUrl, apiKey, model).
  const stars = page.getByRole("dialog").locator("label span", { hasText: "*" });
  await expect(stars).toHaveCount(5);

  // Fill + save.
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/i).fill("e2e-conn-1");
  await dialog.getByRole("combobox", { name: /category/i }).click();
  await page.getByRole("option", { name: /chat/i }).click();
  await dialog.getByLabel(/api base url/i).fill("http://example.test:8000");
  await dialog.getByLabel(/api key/i).fill("sk-test-not-real");
  await dialog.getByLabel(/^Model/i).fill("test-model");
  await dialog.getByRole("button", { name: /^save$/i }).click();

  // Dialog closes, new row visible in the list.
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("cell", { name: "e2e-conn-1", exact: true })).toBeVisible();
});

test("edit connection → name updates in list", async ({ page }) => {
  await page.goto("/connections");
  await createConnection(page, "e2e-edit-before", 8001);
  await expect(page.getByRole("cell", { name: "e2e-edit-before", exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // Edit pencil icon button on the row (aria-label="Edit").
  await page
    .getByRole("button", { name: /^edit$/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Replace the name.
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/i).fill("e2e-edit-after");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

  // Old name gone, new name shows.
  await expect(page.getByRole("cell", { name: "e2e-edit-before", exact: true })).not.toBeVisible();
  await expect(page.getByRole("cell", { name: "e2e-edit-after", exact: true })).toBeVisible();
});

test("delete connection → row removed", async ({ page }) => {
  await page.goto("/connections");
  await createConnection(page, "e2e-delete-me", 8002);
  await expect(page.getByRole("cell", { name: "e2e-delete-me", exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // Delete row + confirm via the AlertDialog.
  await page
    .getByRole("button", { name: /^delete$/i })
    .first()
    .click();
  // Confirm in the alert dialog.
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^delete$/i })
    .click();

  await expect(page.getByRole("cell", { name: "e2e-delete-me", exact: true })).not.toBeVisible({
    timeout: 10_000,
  });
});

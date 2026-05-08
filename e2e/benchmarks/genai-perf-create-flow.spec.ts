import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";
import { clickSave } from "../helpers/form";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

/**
 * Happy-path smoke for the genai-perf benchmark create flow.
 *
 * Does NOT require a live K8s cluster or a real genai-perf binary.
 * The test verifies:
 *   1. The form accepts a connection, picks genai-perf as the tool,
 *      fills the minimal required params, and passes client-side
 *      validation (Submit becomes enabled).
 *   2. The POST /api/benchmarks request is not a 4xx (malformed body
 *      would be a contract regression; a 5xx from the missing K8s
 *      runner is acceptable).
 *   3. On 2xx the browser navigates to /benchmarks/<id>.
 *
 * NOTE: In test env the K8s runner is unavailable so the api returns 5xx
 * after validation — same contract as the existing benchmarks.spec.ts.
 */

test("create genai-perf benchmark — happy path", async ({ page }) => {
  // Step 1: seed a connection via the UI so the picker has an entry.
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/i).fill("e2e-genai-perf-conn");
  await dialog.getByRole("combobox", { name: /category/i }).click();
  await page.getByRole("option", { name: /chat/i }).click();
  await dialog.getByLabel(/api base url/i).fill("http://example.test:8000");
  await dialog.getByLabel(/api key/i).fill("sk-test-not-real");
  await dialog.getByLabel(/^Model/i).fill("test-model");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // Step 2: navigate to the create page with scenario=inference (default,
  // but explicit so the URL is deterministic and genai-perf is available).
  await page.goto("/benchmarks/new?scenario=inference");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

  // Step 3: pick the connection.
  // The ConnectionPicker is the first combobox on the page (inside Target card).
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "e2e-genai-perf-conn" }).click();

  // Step 4: switch the tool to genai-perf.
  // The Tool selector is the second combobox (aria-label="Tool").
  await page.getByRole("combobox", { name: /^tool$/i }).click();
  await page.getByRole("option", { name: /genai-perf/i }).click();

  // Step 5: fill the benchmark name (required).
  const name = page.getByLabel(/^Name/i);
  await name.fill("e2e-genai-perf-1");
  await name.press("Tab");

  // numPrompts and concurrency have defaults (100 and 1) from genaiPerfParamDefaults
  // so we don't need to touch them. endpointType also has a default ("chat").
  // The form should now be valid.

  // Step 6: spy on the POST, then submit.
  const benchmarkCallPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/benchmarks") && r.request().method() === "POST",
  );
  await clickSave(page);
  const response = await benchmarkCallPromise;

  // Step 7: assert the request body has the right shape.
  const body = await response.request().postDataJSON();
  expect(body).toMatchObject({
    name: "e2e-genai-perf-1",
    scenario: "inference",
    tool: "genai-perf",
  });
  expect(body.params).toMatchObject({
    endpointType: "chat",
  });

  // Step 8: not a client error (4xx would mean bad request body).
  const status = response.status();
  const isClientError = status >= 400 && status < 500;
  expect(isClientError, `unexpected client error: ${status}`).toBe(false);

  // Step 9: on 2xx, the browser navigates to /benchmarks/<id> and the
  // detail page shows a lifecycle status badge. On 5xx (runner not
  // available in test env) we skip the navigation assertion — the form
  // flow up to submission is already verified above.
  if (status >= 200 && status < 300) {
    await page.waitForURL(/\/benchmarks\/[^/]+$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/benchmarks\/[^/]+$/);
    // StatusBadge renders one of: pending | submitted | running | completed | failed
    const statusBadge = page.getByRole("status").or(
      page.locator('[aria-label="pending"], [aria-label="Pending"], [aria-label="submitted"], [aria-label="Submitted"], [aria-label="running"], [aria-label="Running"], [aria-label="failed"], [aria-label="Failed"]'),
    );
    await expect(statusBadge.first()).toBeVisible({ timeout: 10_000 });
  }
});

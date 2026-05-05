import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers/auth";
import { resetTestDb } from "./helpers/db";
import { clickSave } from "./helpers/form";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

/**
 * NOTE — running a benchmark end-to-end isn't viable in this e2e env:
 * `BENCHMARK_DRIVER=subprocess` (the default) tries to actually spawn
 * vegeta / guidellm / genai-perf, which aren't installed inside the
 * test container. So the smoke covers the FORM integration (connection
 * picker, params, validation) and asserts the api was called with the
 * right shape, then accepts the runner's 500 as known. Replacing the
 * driver with a noop is its own task.
 */

test("create benchmark form: connection picker + tool params + submit hits api", async ({
  page,
}) => {
  // Step 1: seed a connection so the picker has something to choose.
  await page.goto("/connections");
  await page.getByRole("button", { name: /new connection/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/i).fill("e2e-bench-conn");
  await dialog.getByRole("combobox", { name: /category/i }).click();
  await page.getByRole("option", { name: /chat/i }).click();
  await dialog.getByLabel(/api base url/i).fill("http://example.test:8000");
  await dialog.getByLabel(/api key/i).fill("sk-test-not-real");
  await dialog.getByLabel(/^Model/i).fill("test-model");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // Step 2: fill the BenchmarkCreatePage form.
  await page.goto("/benchmarks/new");
  await expect(page.getByRole("heading", { level: 1, name: /new benchmark/i })).toBeVisible();

  // Required asterisks: Connection + Input tokens + Output tokens + Name.
  // Input/Output tokens are required only when datasetName=random (default
  // for guidellm) — see GuidellmParamsForm.
  await expect(page.locator("label span", { hasText: "*" })).toHaveCount(4);

  // ConnectionPicker — first combobox on the page (Endpoint section).
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "e2e-bench-conn" }).click();

  // Default scenario "inference" + tool "guidellm" + datasetName "random"
  // requires Input/Output tokens (no defaults in guidellmParamDefaults).
  await page.getByLabel(/input tokens/i).fill("128");
  await page.getByLabel(/output tokens/i).fill("128");

  // Metadata. Tab to blur name so onTouched-mode lets Submit enable.
  const name = page.getByLabel(/^Name/i);
  await name.fill("e2e-bench-1");
  await name.press("Tab");

  // Spy on the create call and submit. We don't require 2xx — the
  // subprocess runner isn't installed in test env, so the api will 500
  // after validation. The smoke verifies the request shape is correct
  // (would-be 4xx if Bad Request) and the form actually wired up.
  const benchmarkCallPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/benchmarks") && r.request().method() === "POST",
  );
  await clickSave(page);
  const response = await benchmarkCallPromise;
  const body = await response.request().postDataJSON();
  expect(body).toMatchObject({
    name: "e2e-bench-1",
    scenario: "inference",
    tool: "guidellm",
  });
  // Status contract: anything but a 4xx is fine.
  //  - 4xx would mean malformed body (catches contract regressions)
  //  - 5xx is the expected runner-spawn failure in test env
  //  - 2xx would mean a runner unexpectedly worked (also fine)
  const status = response.status();
  const isClientError = status >= 400 && status < 500;
  expect(isClientError, `unexpected client error: ${status}`).toBe(false);
});

test("paste cURL on benchmark create opens save-connection dialog prefilled", async ({ page }) => {
  // Cover the ConnectionPicker integration: paste-cURL on a page that
  // requires a saved connection (allowManual=false) opens
  // ConnectionDialog prefilled (post-#99 contract).
  await page.goto("/benchmarks/new");

  await page.getByRole("button", { name: /paste cURL|粘贴 cURL/i }).click();
  const curlBox = page.getByPlaceholder(/curl http/i);
  await expect(curlBox).toBeVisible();

  await curlBox.fill(
    'curl http://example.test:9000/v1/chat/completions ' +
      '-H "Authorization: Bearer sk-curl" ' +
      '-d \'{"model":"curl-model"}\'',
  );
  await page.getByRole("button", { name: /parse|解析/i }).click();

  // ConnectionDialog opens prefilled with the parsed values.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByLabel(/api base url/i)).toHaveValue(/example\.test:9000/);
  await expect(dialog.getByLabel(/^Model/i)).toHaveValue("curl-model");
});

import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";
import { clickSave } from "../helpers/form";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

/**
 * Smoke test for the vegeta gateway "custom request" feature (Task 16).
 *
 * What's covered:
 *   - Creating an embeddings-category connection
 *   - Navigating to /benchmarks/new?scenario=gateway (vegeta tool)
 *   - Picking the connection on the form
 *   - Opening the Advanced disclosure
 *   - Asserting path auto-derives to /v1/embeddings
 *   - Asserting body uses the embeddings template (model + input, NOT messages)
 *   - Submitting and accepting the runner's 500 (k8s not available in test env)
 *
 * What's NOT covered:
 *   - Benchmark reaching a terminal state (k8s runner unavailable in e2e)
 *   - RequestDetailsSection rendering on the detail page
 *     → covered by RequestDetailsSection.test.tsx (unit)
 */
test("vegeta gateway form auto-fills path + body from embeddings connection", async ({ page }) => {
  // ── Step 1: seed an embeddings-category connection ─────────────────────────
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/^Name/i).fill("e2e-emb");
  await dialog.getByRole("combobox", { name: /category/i }).click();
  // The category option label is i18n'd — match both zh-CN "嵌入" and en-US "embeddings".
  await page.getByRole("option", { name: /嵌入|embeddings/i }).click();
  await dialog.getByLabel(/api base url/i).fill("http://example.test:8000");
  await dialog.getByLabel(/api key/i).fill("sk-e2e-emb");
  await dialog.getByLabel(/^Model/i).fill("bge-m3-test");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // ── Step 2: navigate to gateway benchmark create page ──────────────────────
  await page.goto("/benchmarks/new?scenario=gateway");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ── Step 3: pick the embeddings connection ─────────────────────────────────
  // ConnectionPicker renders a combobox; it's the first one in the Endpoint section.
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "e2e-emb" }).click();

  // ── Step 4: open the Advanced disclosure ──────────────────────────────────
  // VegetaParamsForm renders <details><summary>Advanced</summary>…</details>.
  // Playwright doesn't expose <summary> as a "button" role by default; use
  // the element selector directly.
  await page.locator("summary", { hasText: /^Advanced$/i }).click();

  // ── Step 5: assert path auto-derived to /v1/embeddings ────────────────────
  // FormLabel "Path" sets htmlFor=formItemId; FormControl sets id=formItemId
  // on the <input>, so getByLabel resolves correctly.
  await expect(page.getByLabel(/^Path$/i)).toHaveValue("/v1/embeddings", { timeout: 5_000 });

  // ── Step 6: assert body uses the embeddings template (model + input) ───────
  // Use getByPlaceholder as a robust fallback if getByLabel("Body") is ambiguous.
  const bodyField =
    (await page.getByLabel(/^Body$/i).count()) > 0
      ? page.getByLabel(/^Body$/i).first()
      : page.getByPlaceholder(/input.*hello|model.*…/i);
  const bodyValue = await bodyField.inputValue();
  const parsed = JSON.parse(bodyValue);
  expect(parsed.model).toBe("bge-m3-test");
  // Embeddings template: { model, input } — NOT the chat template { model, messages }.
  expect(parsed.input).toBe("hello");
  expect(parsed).not.toHaveProperty("messages");

  // ── Step 7: fill required metadata and submit ──────────────────────────────
  const nameField = page.getByLabel(/^Name/i);
  await nameField.fill("e2e-gateway-emb");
  await nameField.press("Tab");

  const benchmarkCallPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/benchmarks") && r.request().method() === "POST",
  );
  await clickSave(page);
  const response = await benchmarkCallPromise;

  // Verify request shape reached the API (any non-4xx is acceptable;
  // 5xx = expected runner failure in test env, 4xx = form bug).
  const body = await response.request().postDataJSON();
  expect(body).toMatchObject({
    name: "e2e-gateway-emb",
    scenario: "gateway",
    tool: "vegeta",
  });
  expect(body.params?.path).toBe("/v1/embeddings");
  const sentBody = JSON.parse(body.params?.body ?? "{}");
  expect(sentBody.model).toBe("bge-m3-test");
  expect(sentBody.input).toBe("hello");

  const status = response.status();
  const isClientError = status >= 400 && status < 500;
  expect(isClientError, `unexpected client error ${status}`).toBe(false);
});

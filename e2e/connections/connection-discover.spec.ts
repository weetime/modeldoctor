import { expect, test } from "@playwright/test";
import { MockVllmServer } from "../fixtures/mock-vllm-server";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

let mock: MockVllmServer;

test.beforeAll(async () => {
  mock = new MockVllmServer();
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("Discover fills 5 fields from a vLLM-shaped endpoint", async ({ page }) => {
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection|新建连接/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name|^名称/i).fill("e2e-vllm");
  await dialog.getByLabel(/api base url/i).fill(mock.url);
  await dialog.getByLabel(/api key/i).fill("sk-e2e");

  await dialog.getByRole("button", { name: /Discover|自动发现/i }).click();

  // Wait for the success banner — auto-detected fields message
  await expect(dialog.getByText(/Detected|已检测到/i)).toBeVisible({ timeout: 15_000 });

  // Apply All
  await dialog.getByRole("button", { name: /Apply All|一键应用/i }).click();

  // Model field auto-filled
  await expect(dialog.getByLabel(/^Model|^模型/i)).toHaveValue("llama-3-8b-instruct");

  // serverKind combobox displays "vLLM" as its selected label.
  await expect(dialog.getByRole("combobox").filter({ hasText: /^vLLM$/ })).toBeVisible();

  // Suggested tag chip "vllm" rendered
  await expect(dialog.getByText("vllm", { exact: true })).toBeVisible();
});

test("Discover rejects AWS metadata URL with security warning", async ({ page }) => {
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection|新建连接/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name|^名称/i).fill("e2e-ssrf");
  await dialog.getByLabel(/api base url/i).fill("http://169.254.169.254/latest");

  await dialog.getByRole("button", { name: /Discover|自动发现/i }).click();

  // Security/SSRF banner appears; Apply All button must NOT be rendered.
  await expect(dialog.getByText(/security|安全/i)).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByRole("button", { name: /Apply All|一键应用/i }),
  ).not.toBeVisible();
});

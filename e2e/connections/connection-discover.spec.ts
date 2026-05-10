import { expect, test } from "@playwright/test";
import { MockHigressServer, MockVllmServer } from "../fixtures/mock-vllm-server";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

let mock: MockVllmServer;
let higress: MockHigressServer;

test.beforeAll(async () => {
  mock = new MockVllmServer();
  higress = new MockHigressServer();
  await Promise.all([mock.start(), higress.start()]);
});

test.afterAll(async () => {
  await Promise.all([mock.stop(), higress.stop()]);
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
  await expect(dialog.getByText(/Detected \d+ fields|已检测到 \d+ 个字段/i)).toBeVisible({
    timeout: 15_000,
  });

  // Apply All
  await dialog.getByRole("button", { name: /Apply All|一键应用/i }).click();

  // Model field auto-filled
  await expect(dialog.getByLabel(/^Model|^模型/i)).toHaveValue("llama-3-8b-instruct");

  // serverKind combobox displays "vLLM" as its selected label.
  await expect(dialog.getByRole("combobox").filter({ hasText: /^vLLM$/ })).toBeVisible();

  // Suggested tag chip "vllm" rendered — assert via the chip's remove-button
  // aria-label (uniquely identifies the chip; sidesteps text-collision with
  // the new details panel's serverKind value).
  await expect(
    dialog.getByRole("button", { name: /remove tag vllm|移除标签 vllm/i }),
  ).toBeVisible();
});

test("Discover preserves user-edited model field in edit mode", async ({ page }) => {
  // Seed an existing connection via the UI flow (auth uses an in-memory
  // bearer token, not just cookies, so page.request can't reuse the session).
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection|新建连接/i })
    .first()
    .click();
  const create = page.getByRole("dialog");
  await expect(create).toBeVisible();
  await create.getByLabel(/^Name|^名称/i).fill("e2e-edit-discover");
  await create.getByRole("combobox", { name: /category|分类/i }).click();
  await page.getByRole("option", { name: /^chat$|^对话$/i }).click();
  await create.getByLabel(/api base url/i).fill(mock.url);
  await create.getByLabel(/api key/i).fill("sk-old");
  await create.getByLabel(/^Model|^模型/i).fill("old-model");
  await create.getByRole("button", { name: /^save$|^保存$/i }).click();
  await expect(create).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("cell", { name: "e2e-edit-discover", exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // Open the row for editing via the row-level "Edit" button.
  await page
    .getByRole("button", { name: /^edit$|^编辑$/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // User manually changes the model field (pre-Discover edit).
  const modelInput = dialog.getByLabel(/^Model|^模型/i);
  await modelInput.fill("manually-typed-model");

  // Trigger Discover.
  await dialog.getByRole("button", { name: /Discover|自动发现/i }).click();
  await expect(dialog.getByRole("button", { name: /Apply All|一键应用/i })).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: /Apply All|一键应用/i }).click();

  // Model field MUST stay at user-typed value (server suggested "llama-3-8b-instruct").
  await expect(modelInput).toHaveValue("manually-typed-model");
});

test("Discover succeeds against a Higress-style gateway when customHeaders is set", async ({
  page,
}) => {
  await page.goto("/connections");
  await page
    .getByRole("button", { name: /new connection|新建连接/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/^Name|^名称/i).fill("e2e-higress");
  await dialog.getByLabel(/api base url/i).fill(higress.url);
  await dialog.getByLabel(/api key/i).fill("sk-higress");

  // First attempt without customHeaders → all probes return 404 → no inferred fields
  await dialog.getByRole("button", { name: /Discover|自动发现/i }).click();
  await expect(dialog.getByText(/手动填写|fill manually/i)).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByRole("button", { name: /Apply All|一键应用/i }),
  ).not.toBeVisible();

  // Now add the routing header and re-Discover — should succeed.
  await dialog
    .getByLabel(/custom headers|自定义请求头/i)
    .fill("x-higress-llm-model: qwen-72b");
  await dialog.getByRole("button", { name: /Discover|自动发现/i }).click();
  await expect(dialog.getByText(/Detected \d+ fields|已检测到 \d+ 个字段/i)).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: /Apply All|一键应用/i }).click();

  await expect(dialog.getByLabel(/^Model|^模型/i)).toHaveValue("qwen-72b");
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

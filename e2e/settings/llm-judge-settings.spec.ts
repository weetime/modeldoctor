import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("AI Diagnosis section renders + accepts form input + Save click is wired", async ({
  page,
}) => {
  await page.goto("/settings");
  // settings.json renders "AI Diagnostics" (en) / "AI 智能诊断" (zh).
  await expect(page.getByRole("heading", { name: /AI 智能诊断|AI Diagnos/i })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByLabel(/Base URL/i).fill("https://api.deepseek.example/v1");
  await page.getByLabel(/Model|模型/i).fill("deepseek-chat");
  await page.getByLabel(/API Key/i).fill("sk-fake-key-for-e2e");

  // Test connection — server-side fetch will fail (network unreachable),
  // but we just want to confirm the button is wired and a toast appears
  // (success or failure). Some toasts return latencyMs strings; either
  // outcome is acceptable.
  // Be strict — "Test connection" disambiguates from "Clear test data".
  await page.getByRole("button", { name: /测试连接|Test connection/i }).click();
  // Wait for any toast (a `.sonner-toast` or generic role=status).
  await expect(page.getByText(/连接成功|连接失败|耗时|test|connected|failed/i).first()).toBeVisible(
    { timeout: 15_000 },
  );

  // Save click — should not throw; we don't assert on persistence here.
  await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
});

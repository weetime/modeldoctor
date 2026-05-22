import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Click a Save / Submit / similar button after waiting for it to become
 * enabled. Forms in this repo gate the submit button on
 * `formState.isValid` (mode: "onTouched"), so the button is disabled
 * until at least one field has been touched + validated. Filling alone
 * doesn't trigger a blur in Playwright; pressing Tab or focusing the
 * next field does. This helper hides that timing detail from specs.
 */
export async function clickWhenEnabled(button: Locator, timeout = 10_000): Promise<void> {
  await expect(button).toBeEnabled({ timeout });
  await button.click();
}

/**
 * Within a scope (page or dialog), find the Save button and click it
 * once enabled. Matches `Save`, `Submit`, `Create`, `保存`, `提交`
 * (case-insensitive, anchored to avoid accidentally hitting "Save as
 * new connection" etc.).
 */
export async function clickSave(scope: Page | Locator): Promise<void> {
  await clickWhenEnabled(scope.getByRole("button", { name: /^(save|submit|创建|保存|提交)$/i }));
}

import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Cobros', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/cobros');
  });

  test('should load cobros page without errors', async ({ page }) => {
    await expect(page.locator('h2:has-text("Cobros")')).toBeVisible({ timeout: 15000 });
    // Should NOT show "Failed to get orders" error
    const errorMsg = page.locator('text=Failed to get orders');
    await expect(errorMsg).not.toBeVisible({ timeout: 5000 });
  });

  test('should display cobros content', async ({ page }) => {
    await page.waitForTimeout(3000);
    // Should have either "Pedidos por Cobrar" section or empty state
    const cobrosContent = page.locator('text=/Cobrar|cobro|Registrar|Sin pedidos/').first();
    await expect(cobrosContent).toBeVisible({ timeout: 15000 });
  });
});

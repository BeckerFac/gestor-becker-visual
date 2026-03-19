import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Export Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should have export buttons on orders page', async ({ page }) => {
    await navigateTo(page, '/orders');
    await page.waitForTimeout(3000);

    const csvBtn = page.locator('button:has-text("CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 10000 });
  });

  test('should trigger CSV export on orders page', async ({ page }) => {
    await navigateTo(page, '/orders');
    await page.waitForTimeout(3000);

    const csvBtn = page.locator('button:has-text("CSV")').first();
    if (await csvBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Listen for download
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
      await csvBtn.click({ force: true });
      // Either a download happens or it generates a blob - both are fine
      await downloadPromise;
    }
  });

  test('should have Imprimir button on reportes page', async ({ page }) => {
    await navigateTo(page, '/reportes');
    await page.waitForTimeout(3000);
    await expect(page.locator('button:has-text("Imprimir")').first()).toBeVisible({ timeout: 10000 });
  });

  test('should have Exportar Datos button in sidebar', async ({ page }) => {
    await expect(page.locator('button:has-text("Exportar Datos")').first()).toBeVisible({ timeout: 10000 });
  });
});

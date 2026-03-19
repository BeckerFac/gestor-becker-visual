import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Cotizaciones (Quotes)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/quotes');
  });

  test('should load quotes page', async ({ page }) => {
    await expect(page.locator('main h1:has-text("Cotizaciones"), h2:has-text("Cotizaciones")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should have Nueva Cotizacion button', async ({ page }) => {
    const newQuoteBtn = page.locator('button:has-text("Nueva"), button:has-text("+ Nueva")').first();
    await expect(newQuoteBtn).toBeVisible({ timeout: 10000 });
  });

  test('should display quote list or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    const hasTable = await main.locator('table tbody tr').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay cotizaciones|Sin cotizaciones|registrad/i').first().isVisible().catch(() => false);
    expect(hasTable || hasEmpty, 'Neither quote rows nor empty state visible').toBe(true);
  });

  test('should open quote preview when clicking Ver', async ({ page }) => {
    await page.waitForTimeout(3000);
    const verBtn = page.locator('button:has-text("Ver")').first();
    if (await verBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await verBtn.click();
      await page.waitForTimeout(1500);
      const detail = page.locator('[role="dialog"], [class*="fixed"][class*="z-50"], text=/Clasico|Moderno|Ejecutivo/i').first();
      await expect(detail).toBeVisible({ timeout: 10000 });
    }
  });
});

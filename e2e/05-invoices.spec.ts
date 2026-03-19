import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Facturas (Invoices)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/invoices');
  });

  test('should load invoices page', async ({ page }) => {
    await expect(page.locator('main h1:has-text("Facturas"), h2:has-text("Facturas")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should show invoice tabs or section toggles', async ({ page }) => {
    // Look for tab-like controls or section headers for AFIP/No Fiscal
    const main = page.locator('main');
    const afipTab = main.locator('button:has-text("AFIP"), [role="tab"]:has-text("AFIP")').first();
    const noFiscalTab = main.locator('button:has-text("No Fiscal"), [role="tab"]:has-text("No Fiscal")').first();
    const afipVisible = await afipTab.isVisible({ timeout: 10000 }).catch(() => false);
    const noFiscalVisible = await noFiscalTab.isVisible({ timeout: 3000 }).catch(() => false);
    expect(afipVisible || noFiscalVisible, 'Neither AFIP nor No Fiscal tab visible').toBe(true);
  });

  test('should display invoice list or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    const hasTable = await main.locator('table tbody tr').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay facturas|Sin facturas|registrad/i').first().isVisible().catch(() => false);
    expect(hasTable || hasEmpty, 'Neither invoice rows nor empty state visible').toBe(true);
  });
});

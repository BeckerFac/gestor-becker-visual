import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Pedidos (Orders)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/orders');
  });

  test('should load orders page', async ({ page }) => {
    await expect(page.locator('h1:has-text("Pedidos"), h2:has-text("Pedidos")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display order list or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    // Check for table rows in main content OR empty state heading
    const hasTable = await main.locator('table tbody tr').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay pedidos|Sin pedidos|registrados/i').first().isVisible().catch(() => false);
    expect(hasTable || hasEmpty, 'Neither order rows nor empty state visible').toBe(true);
  });

  test('should have Nuevo Pedido button', async ({ page }) => {
    const newOrderBtn = page.locator('button:has-text("Nuevo Pedido"), button:has-text("+ Nuevo")').first();
    await expect(newOrderBtn).toBeVisible({ timeout: 10000 });
  });

  test('should have export buttons', async ({ page }) => {
    const csvBtn = page.locator('button:has-text("CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 10000 });
  });

  test('should open new order form when clicking Nuevo Pedido', async ({ page }) => {
    const newOrderBtn = page.locator('button:has-text("Nuevo Pedido"), button:has-text("+ Nuevo")').first();
    await expect(newOrderBtn).toBeVisible({ timeout: 10000 });
    await newOrderBtn.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(1500);
    const formField = page.locator('select, input[placeholder], [role="combobox"], [role="dialog"]').first();
    await expect(formField).toBeVisible({ timeout: 10000 });
  });
});

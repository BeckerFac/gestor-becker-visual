import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Productos (Products)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/products');
  });

  test('should load products page', async ({ page }) => {
    await expect(page.locator('main h1:has-text("Productos"), h2:has-text("Productos")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display product list or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    const hasTable = await main.locator('table tbody tr').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay productos|Sin productos|registrad|Agrega tu primer/i').first().isVisible().catch(() => false);
    expect(hasTable || hasEmpty, 'Neither product rows nor empty state visible').toBe(true);
  });

  test('should have product management buttons', async ({ page }) => {
    const main = page.locator('main');
    const tiposBtn = main.locator('button:has-text("Gestionar tipos")').first();
    const newProductBtn = main.locator('button:has-text("Nuevo Producto"), button:has-text("+ Nuevo")').first();
    const tiposVisible = await tiposBtn.isVisible({ timeout: 5000 }).catch(() => false);
    const newVisible = await newProductBtn.isVisible({ timeout: 3000 }).catch(() => false);
    expect(tiposVisible || newVisible, 'No product management buttons found').toBe(true);
  });

  test('should have product action capabilities', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    const actionBtn = main.locator('button:has-text("Nuevo"), button:has-text("Editar"), button:has-text("Agregar")').first();
    await expect(actionBtn).toBeVisible({ timeout: 10000 });
  });
});

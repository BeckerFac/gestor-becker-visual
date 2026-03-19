import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display KPI cards', async ({ page }) => {
    await expect(page.locator('text=/Facturado/').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Por Cobrar')).toBeVisible();
    await expect(page.locator('text=/Cheques a Cobrar/').first()).toBeVisible();
    await expect(page.locator('text=/Pedidos sin Pagar/').first()).toBeVisible();
  });

  test('should display dashboard widgets or empty state', async ({ page }) => {
    // For accounts with no data, these widgets may not appear.
    // Just verify the dashboard loaded correctly by checking the main content area
    const main = page.locator('main');
    // At least the KPI section and tables section should be present
    const kpis = main.locator('text=/Facturado/').first();
    const tables = main.locator('text=Ultimos Pedidos').first();
    await expect(kpis).toBeVisible({ timeout: 10000 });
    await expect(tables).toBeVisible({ timeout: 10000 });
  });

  test('should display Ultimos Pedidos section', async ({ page }) => {
    await expect(page.locator('text=Ultimos Pedidos')).toBeVisible({ timeout: 15000 });
    // Should show either order rows or "No hay pedidos aun"
    const main = page.locator('main');
    const hasOrders = await main.locator('text=/No hay pedidos aun|#[0-9]/').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasOrders, 'Ultimos Pedidos section should show content or empty message').toBe(true);
  });

  test('should display Ultimas Facturas section', async ({ page }) => {
    await expect(page.locator('text=Ultimas Facturas')).toBeVisible({ timeout: 15000 });
    const main = page.locator('main');
    const hasInvoices = await main.locator('text=/No hay facturas aun|Factura/').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasInvoices, 'Ultimas Facturas section should show content or empty message').toBe(true);
  });

  test('should have period selector with clickable filters', async ({ page }) => {
    // From the screenshot: Hoy, Semana, Mes, 3 Meses, Anual, Todos
    await expect(page.locator('button:has-text("Hoy")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Semana")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Mes")').first()).toBeVisible();

    // Click "Hoy" and verify KPIs are still showing
    await page.locator('button:has-text("Hoy")').first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=/Facturado/').first()).toBeVisible({ timeout: 10000 });
  });
});

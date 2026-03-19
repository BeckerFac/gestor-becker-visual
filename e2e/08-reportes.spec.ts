import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Reportes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/reportes');
  });

  test('should load reportes page', async ({ page }) => {
    await expect(page.locator('main h1:has-text("Reportes"), h2:has-text("Reportes")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display tab buttons for business reports', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.locator('[role="tab"]:has-text("Ventas"), button:has-text("Ventas")').first()).toBeVisible({ timeout: 10000 });
    await expect(main.locator('[role="tab"]:has-text("Rentabilidad"), button:has-text("Rentabilidad")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Clientes"), button:has-text("Clientes")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Cobranzas"), button:has-text("Cobranzas")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Inventario"), button:has-text("Inventario")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Conversion"), button:has-text("Conversion")').first()).toBeVisible();
  });

  test('should display tab buttons for accounting reports', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.locator('[role="tab"]:has-text("Libro IVA Ventas"), button:has-text("Libro IVA Ventas")').first()).toBeVisible({ timeout: 10000 });
    await expect(main.locator('[role="tab"]:has-text("Libro IVA Compras"), button:has-text("Libro IVA Compras")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Posicion IVA"), button:has-text("Posicion IVA")').first()).toBeVisible();
    await expect(main.locator('[role="tab"]:has-text("Flujo de Caja"), button:has-text("Flujo de Caja")').first()).toBeVisible();
  });

  test('should switch to Ventas tab and show content', async ({ page }) => {
    const main = page.locator('main');
    const ventasTab = main.locator('[role="tab"]:has-text("Ventas"), button:has-text("Ventas")').first();
    await ventasTab.click();
    await page.waitForTimeout(2000);
    // Should show table data or "No hay actividad" empty state
    const hasContent = await main.locator('table').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay actividad|No hay datos|Sin datos/i').first().isVisible().catch(() => false);
    expect(hasContent || hasEmpty, 'Ventas tab should show data or empty state').toBe(true);
  });

  test('should switch to Cobranzas tab without error', async ({ page }) => {
    const main = page.locator('main');
    const cobranzasTab = main.locator('[role="tab"]:has-text("Cobranzas"), button:has-text("Cobranzas")').first();
    await cobranzasTab.click();
    await page.waitForTimeout(2000);
    const hasContent = await main.locator('table').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay actividad|No hay datos|Sin datos/i').first().isVisible().catch(() => false);
    expect(hasContent || hasEmpty, 'Cobranzas tab should show data or empty state').toBe(true);
  });

  test('should switch to Flujo de Caja tab', async ({ page }) => {
    const main = page.locator('main');
    const flujoTab = main.locator('[role="tab"]:has-text("Flujo de Caja"), button:has-text("Flujo de Caja")').first();
    await flujoTab.click();
    await page.waitForTimeout(2000);
    // Flujo de caja should render chart (canvas/svg), table, or empty state
    const hasChart = await main.locator('canvas').first().isVisible().catch(() => false);
    const hasSvg = await main.locator('svg.recharts-surface').first().isVisible().catch(() => false);
    const hasTable = await main.locator('table').first().isVisible().catch(() => false);
    const hasEmpty = await main.locator('text=/No hay actividad|No hay datos|Sin datos/i').first().isVisible().catch(() => false);
    expect(hasChart || hasSvg || hasTable || hasEmpty, 'Flujo de Caja should show chart or empty state').toBe(true);
  });

  test('should have date filter presets', async ({ page }) => {
    await expect(page.locator('button:has-text("Este mes")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Mes anterior")').first()).toBeVisible();
  });

  test('should have Imprimir button', async ({ page }) => {
    await expect(page.locator('button:has-text("Imprimir")').first()).toBeVisible({ timeout: 10000 });
  });
});

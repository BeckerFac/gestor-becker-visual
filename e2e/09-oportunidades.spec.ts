import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Oportunidades (Pipeline CRM)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, '/oportunidades');
  });

  test('should load oportunidades page', async ({ page }) => {
    await expect(page.locator('main h1:has-text("Oportunidades"), h2:has-text("Oportunidades")').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display kanban board with stage columns', async ({ page }) => {
    await page.waitForTimeout(3000);
    const main = page.locator('main');
    // From the snapshot: columns have stage names like Contacto, Cotizacion, etc.
    // They also show "Sin deals" when empty
    const hasStages = await main.locator('text=Contacto').first().isVisible().catch(() => false);
    const hasSinDeals = await main.locator('text=Sin deals').first().isVisible().catch(() => false);
    expect(hasStages || hasSinDeals, 'Kanban board should show stage columns').toBe(true);
  });

  test('should have Nuevo Deal button', async ({ page }) => {
    await expect(page.locator('button:has-text("Nuevo Deal")').first()).toBeVisible({ timeout: 10000 });
  });

  test('should have Configurar etapas button', async ({ page }) => {
    await expect(page.locator('button:has-text("Configurar etapas")').first()).toBeVisible({ timeout: 10000 });
  });

  test('should open Configurar etapas modal', async ({ page }) => {
    const configBtn = page.locator('button:has-text("Configurar etapas")').first();
    await configBtn.click();
    await page.waitForTimeout(1500);
    // Modal should appear with stage list
    const main = page.locator('main');
    const hasModal = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
    const hasStageConfig = await page.locator('text=/Agregar etapa|Nombre de la etapa/i').first().isVisible().catch(() => false);
    expect(hasModal || hasStageConfig, 'Configurar etapas modal should open').toBe(true);
  });
});

import { test, expect } from '@playwright/test';
import { login, wakeUpApp } from './helpers/auth';

test.describe('Authentication - Login Page', () => {
  // These tests should NOT use stored auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show login page on initial visit', async ({ page }) => {
    await wakeUpApp(page);
    await expect(page.locator('h1:has-text("BeckerVisual")')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('text=Gestor Comercial Profesional')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("Iniciar")')).toBeVisible();
  });

  test('should show registration form when clicking register link', async ({ page }) => {
    await wakeUpApp(page);
    await page.click('text=Regístrate aquí');
    await expect(page.locator('input[placeholder="Tu nombre"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Mi empresa"]')).toBeVisible();
    await expect(page.locator('input[placeholder="20123456789"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("Crear cuenta")')).toBeVisible();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await wakeUpApp(page);
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    const url = page.url();
    expect(url).not.toContain('/dashboard');
  });
});

test.describe('Authentication - Authenticated', () => {
  // These tests use the stored auth state
  test('should see dashboard after login', async ({ page }) => {
    await login(page);
    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('main h1:has-text("Dashboard")').first()).toBeVisible({ timeout: 10000 });
  });

  test('should see sidebar with navigation items', async ({ page }) => {
    await login(page);
    await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Pedidos")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Cotizaciones")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Facturas")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Productos")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Reportes")')).toBeVisible();
    await expect(page.locator('nav a:has-text("Empresas")')).toBeVisible();
  });
});

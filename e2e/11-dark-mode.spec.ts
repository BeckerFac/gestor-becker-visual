import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Dark Mode', () => {
  test('should toggle dark mode on and off', async ({ page }) => {
    await login(page);

    // Find the theme toggle button (from Header.tsx: aria-label="Activar modo oscuro" or "Activar modo claro")
    const themeToggle = page.locator('button[aria-label*="modo"], button[title*="Modo"]').first();
    await expect(themeToggle).toBeVisible({ timeout: 10000 });

    // Get initial dark mode state
    const initiallyDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    // Click to toggle
    await themeToggle.click();
    await page.waitForTimeout(500);

    const afterToggle = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(afterToggle).toBe(!initiallyDark);

    // Toggle back
    await themeToggle.click();
    await page.waitForTimeout(500);

    const afterSecondToggle = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(afterSecondToggle).toBe(initiallyDark);
  });

  test('should persist dark mode across page navigations', async ({ page }) => {
    await login(page);

    // First determine current state and toggle to dark
    const themeToggle = page.locator('button[aria-label*="modo"], button[title*="Modo"]').first();
    const initiallyDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    if (!initiallyDark) {
      await themeToggle.click();
      await page.waitForTimeout(500);
    }

    // Verify we're in dark mode
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(isDark).toBe(true);

    // Navigate to different pages
    const pages = ['/orders', '/products', '/reportes'];
    for (const p of pages) {
      await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);

      const stillDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      );
      expect(stillDark, `Dark mode lost on page ${p}`).toBe(true);
    }

    // Toggle back to light mode
    const toggle2 = page.locator('button[aria-label*="modo"], button[title*="Modo"]').first();
    await toggle2.click();
    await page.waitForTimeout(500);

    const isLight = await page.evaluate(() =>
      !document.documentElement.classList.contains('dark')
    );
    expect(isLight).toBe(true);
  });
});

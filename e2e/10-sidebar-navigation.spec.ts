import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

const SIDEBAR_ROUTES = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Busqueda Global', path: '/global' },
  { label: 'Pedidos', path: '/orders' },
  { label: 'Cotizaciones', path: '/quotes' },
  { label: 'Facturas', path: '/invoices' },
  { label: 'Remitos', path: '/remitos' },
  { label: 'Oportunidades', path: '/oportunidades' },
  { label: 'Compras', path: '/compras' },
  { label: 'Productos', path: '/products' },
  { label: 'Inventario', path: '/inventory' },
  { label: 'Cobros', path: '/cobros' },
  { label: 'Pagos', path: '/pagos' },
  { label: 'Cuenta Corriente', path: '/cuenta-corriente' },
  { label: 'Cheques', path: '/cheques' },
  { label: 'Reportes', path: '/reportes' },
  { label: 'Empresas', path: '/empresas' },
  { label: 'Bancos', path: '/bancos' },
  { label: 'Usuarios', path: '/users' },
];

test.describe('Sidebar Navigation', () => {
  test('should navigate to every page without crashing', async ({ page }) => {
    await login(page);

    for (const route of SIDEBAR_ROUTES) {
      // Navigate via URL to avoid sidebar visibility issues on desktop/mobile
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Check the page loaded - should not show a white screen or error boundary
      const errorBoundary = page.locator('text=Error en la aplicacion');
      const isError = await errorBoundary.isVisible().catch(() => false);
      expect(isError, `Page ${route.label} (${route.path}) crashed with error boundary`).toBe(false);

      // Page should have some visible content
      const hasContent = await page.locator('main, [class*="space-y"], h2, table').first().isVisible().catch(() => false);
      expect(hasContent, `Page ${route.label} (${route.path}) appears blank`).toBe(true);
    }
  });
});

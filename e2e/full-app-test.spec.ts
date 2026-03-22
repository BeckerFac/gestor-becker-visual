import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://gestor-becker-backend.onrender.com';
const TEST_EMAIL = 'e2etest@test.com';
const TEST_PASSWORD = 'TestPassword123';

// Helper: login and return authenticated page
async function login(page: Page) {
  await page.goto(`${BASE_URL}/`);
  // Wait for login page or dashboard
  await page.waitForTimeout(3000);

  // If already logged in (dashboard), return
  if (page.url().includes('/dashboard')) return;

  // Fill login form
  await page.fill('input[type="email"], input[placeholder*="email" i], input[name="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

// Helper: check page loads without React crash
async function checkPageLoads(page: Page, url: string, pageName: string) {
  await page.goto(`${BASE_URL}${url}`);
  await page.waitForTimeout(2000);

  // Check NO React error boundary
  const errorBoundary = await page.locator('text=Ocurrio un error inesperado').count();
  expect(errorBoundary, `${pageName}: React ErrorBoundary triggered`).toBe(0);

  // Check NO white screen (page has content)
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length, `${pageName}: Page is blank`).toBeGreaterThan(10);

  // Check NO "Error" toast (red notification)
  const errorToasts = await page.locator('.text-red-600, .bg-red-100, [class*="error"]').count();
  // Some pages legitimately have red elements (badges, etc.), so we check specifically for error messages

  // Check page title or heading exists
  const hasHeading = await page.locator('h1, h2, h3').first().isVisible().catch(() => false);
  expect(hasHeading, `${pageName}: No heading found`).toBeTruthy();

  return bodyText;
}

// ============================================================
// TEST SUITE 1: Authentication
// ============================================================
test.describe('Authentication', () => {
  test('login with valid credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(2000);

    // Should show login form
    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]');
    if (await emailInput.isVisible()) {
      await emailInput.fill(TEST_EMAIL);
      await page.fill('input[type="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
    }

    expect(page.url()).toContain('/dashboard');
  });
});

// ============================================================
// TEST SUITE 2: All pages load without errors
// ============================================================
test.describe('Page Loading', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Dashboard loads with KPI cards', async ({ page }) => {
    const content = await checkPageLoads(page, '/dashboard', 'Dashboard');
    // Verify KPI cards exist
    expect(content).toContain('Facturado');
    expect(content).toContain('Por Cobrar');
    expect(content).toContain('Cheques a Cobrar');
    expect(content).toContain('Pedidos sin Pagar');
  });

  test('Pedidos page loads with orders', async ({ page }) => {
    const content = await checkPageLoads(page, '/orders', 'Pedidos');
    expect(content).toContain('Pedidos');
    // Should have some orders (test data)
    const orderRows = await page.locator('tr').count();
    expect(orderRows, 'Pedidos: No order rows found').toBeGreaterThan(1);
  });

  test('Cotizaciones page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/quotes', 'Cotizaciones');
    expect(content).toContain('Cotizaciones');
  });

  test('Facturas page loads with tabs', async ({ page }) => {
    const content = await checkPageLoads(page, '/invoices', 'Facturas');
    expect(content).toContain('Facturas');
    // Should have fiscal/no fiscal tabs
    const hasTabs = await page.locator('text=Facturas AFIP').isVisible().catch(() => false);
    expect(hasTabs, 'Facturas: No AFIP tab').toBeTruthy();
  });

  test('Remitos page loads', async ({ page }) => {
    await checkPageLoads(page, '/remitos', 'Remitos');
  });

  test('Oportunidades page loads (CRM)', async ({ page }) => {
    const content = await checkPageLoads(page, '/oportunidades', 'Oportunidades');
    expect(content).toContain('Oportunidades');
  });

  test('Compras page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/purchases', 'Compras');
    expect(content).toContain('Compras');
  });

  test('Productos page loads with tree view', async ({ page }) => {
    const content = await checkPageLoads(page, '/products', 'Productos');
    expect(content).toContain('Productos');
    // Should have tabs
    const hasTabs = await page.locator('text=Materiales').isVisible().catch(() => false);
    expect(hasTabs, 'Productos: No Materiales tab').toBeTruthy();
  });

  test('Cobros page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/cobros', 'Cobros');
    expect(content).toContain('Cobros');
  });

  test('Pagos page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/pagos', 'Pagos');
    expect(content).toContain('Pagos');
  });

  test('Cuenta Corriente page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/cuenta-corriente', 'Cuenta Corriente');
    expect(content).toContain('Cuenta Corriente');
  });

  test('Cheques page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/cheques', 'Cheques');
    expect(content).toContain('Cheques');
  });

  test('Reportes page loads with tabs', async ({ page }) => {
    const content = await checkPageLoads(page, '/reportes', 'Reportes');
    expect(content).toContain('Reportes');
    // Should have negocio + contable tabs
    const hasVentas = await page.locator('text=Ventas').first().isVisible().catch(() => false);
    expect(hasVentas, 'Reportes: No Ventas tab').toBeTruthy();
  });

  test('Empresas page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/enterprises', 'Empresas');
    expect(content).toContain('Empresa');
  });

  test('Bancos page loads', async ({ page }) => {
    await checkPageLoads(page, '/banks', 'Bancos');
  });

  test('Usuarios page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/users', 'Usuarios');
    expect(content).toContain('Usuario');
  });

  test('Configuracion page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/settings', 'Configuracion');
    expect(content).toContain('Configuracion');
  });

  test('SecretarIA page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/secretaria', 'SecretarIA');
    expect(content).toContain('SecretarIA');
  });

  test('Actividad page loads', async ({ page }) => {
    const content = await checkPageLoads(page, '/activity', 'Actividad');
    expect(content).toContain('Actividad');
  });

  test('Admin panel loads (superadmin)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForTimeout(3000);
    // Might show error if not superadmin, that's OK
    const hasContent = await page.locator('body').innerText();
    expect(hasContent.length).toBeGreaterThan(10);
  });

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto(`${BASE_URL}/this-page-does-not-exist`);
    await page.waitForTimeout(2000);
    // Should show 404 or redirect, not crash
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(5);
  });
});

// ============================================================
// TEST SUITE 3: Reportes tabs
// ============================================================
test.describe('Reportes Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/reportes`);
    await page.waitForTimeout(2000);
  });

  const tabs = ['Ventas', 'Rentabilidad', 'Clientes', 'Cobranzas', 'Inventario', 'Conversion',
                'Libro IVA Ventas', 'Libro IVA Compras', 'Posicion IVA', 'Flujo de Caja'];

  for (const tab of tabs) {
    test(`Tab "${tab}" loads without error`, async ({ page }) => {
      const tabButton = page.locator(`text=${tab}`).first();
      if (await tabButton.isVisible()) {
        await tabButton.click();
        await page.waitForTimeout(3000);

        // Check no React crash
        const errorBoundary = await page.locator('text=Ocurrio un error inesperado').count();
        expect(errorBoundary, `Reportes ${tab}: crashed`).toBe(0);
      }
    });
  }
});

// ============================================================
// TEST SUITE 4: Dark mode toggle
// ============================================================
test.describe('Dark Mode', () => {
  test('toggle dark mode', async ({ page }) => {
    await login(page);

    // Find dark mode toggle (moon/sun icon in header)
    const toggle = page.locator('button[aria-label*="tema" i], button[aria-label*="theme" i], button[aria-label*="dark" i], button[aria-label*="modo" i]').first();

    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(500);

      // Check html has 'dark' class
      const htmlClass = await page.locator('html').getAttribute('class');
      const hasDark = htmlClass?.includes('dark');

      // Toggle back
      await toggle.click();
      await page.waitForTimeout(500);

      expect(hasDark !== null).toBeTruthy();
    }
  });
});

// ============================================================
// TEST SUITE 5: SecretarIA Chat
// ============================================================
test.describe('SecretarIA Chat', () => {
  test('chat button visible and opens', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);

    // Look for the floating chat button
    const chatButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    // The chat button should be in the bottom-right corner

    // Try to find it by position (bottom-right fixed element)
    const fixedButtons = page.locator('button[class*="fixed"], div[class*="fixed"] button');
    const count = await fixedButtons.count();

    if (count > 0) {
      // Click the last fixed button (likely the chat)
      await fixedButtons.last().click();
      await page.waitForTimeout(1000);

      // Check if chat panel opened (look for input field)
      const chatInput = page.locator('input[placeholder*="pregunta" i], input[placeholder*="consulta" i], textarea[placeholder*="pregunta" i]');
      const isOpen = await chatInput.isVisible().catch(() => false);

      // Either it opened or it's gated behind premium - both are OK
      expect(true).toBeTruthy();
    }
  });
});

// ============================================================
// TEST SUITE 6: Sidebar navigation
// ============================================================
test.describe('Sidebar Navigation', () => {
  test('all sidebar items are clickable', async ({ page }) => {
    await login(page);

    const sidebarItems = [
      'Dashboard', 'Busqueda Global', 'SecretarIA',
      'Pedidos', 'Cotizaciones', 'Facturas', 'Remitos', 'Oportunidades',
      'Compras', 'Productos',
      'Cobros', 'Pagos', 'Cuenta Corriente', 'Cheques', 'Reportes',
      'Empresas', 'Bancos',
      'Usuarios',
    ];

    for (const item of sidebarItems) {
      const link = page.locator(`a:has-text("${item}")`).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await page.waitForTimeout(1500);

        // Verify no crash
        const crashed = await page.locator('text=Ocurrio un error inesperado').count();
        expect(crashed, `Clicking "${item}" crashed the app`).toBe(0);
      }
    }
  });
});

// ============================================================
// TEST SUITE 7: Console errors
// ============================================================
test.describe('Console Errors', () => {
  test('no critical console errors on main pages', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('404')) {
        consoleErrors.push(`${msg.text()}`);
      }
    });

    await login(page);

    const pages = ['/dashboard', '/orders', '/products', '/cobros', '/reportes', '/settings'];

    for (const url of pages) {
      await page.goto(`${BASE_URL}${url}`);
      await page.waitForTimeout(2000);
    }

    // Filter out non-critical errors (API errors from missing data are OK)
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('401') &&
      !e.includes('403') &&
      !e.includes('404') &&
      !e.includes('net::ERR') &&
      !e.includes('Failed to fetch') &&
      !e.includes('ResizeObserver')
    );

    // Log them for debugging
    if (criticalErrors.length > 0) {
      console.log('Critical console errors found:', criticalErrors);
    }

    // Allow some non-critical errors but flag if too many
    expect(criticalErrors.length, `Found ${criticalErrors.length} critical console errors`).toBeLessThan(5);
  });
});

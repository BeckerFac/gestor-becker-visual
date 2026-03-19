import { type Page } from '@playwright/test';

/**
 * Sets up route interception to force onboarding_completed=true in /auth/me responses.
 * This prevents the onboarding wizard overlay from blocking tests.
 */
async function interceptAuthMe(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    try {
      const response = await route.fetch();
      const body = await response.json();
      if (body?.user) {
        body.user.onboarding_completed = true;
        if (!body.user.enabled_modules || body.user.enabled_modules.length === 0) {
          body.user.enabled_modules = [
            'orders', 'invoices', 'products', 'inventory', 'purchases',
            'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
            'customers', 'quotes', 'remitos', 'reports', 'crm',
          ];
        }
      }
      await route.fulfill({
        status: response.status(),
        headers: Object.fromEntries(
          Object.entries(response.headers()).filter(([k]) => k.toLowerCase() !== 'content-length')
        ),
        body: JSON.stringify(body),
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-user-id',
            email: 'e2eplaywright@test.com',
            name: 'E2E Test',
            role: 'admin',
            company_id: 'mock-company-id',
            active: true,
            onboarding_completed: true,
            enabled_modules: [
              'orders', 'invoices', 'products', 'inventory', 'purchases',
              'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
              'customers', 'quotes', 'remitos', 'reports', 'crm',
            ],
          },
        }),
      });
    }
  });

  // Also intercept /auth/refresh for mock token scenarios
  await page.route('**/api/auth/refresh', async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'mock-refreshed-token',
          refreshToken: 'mock-refreshed-refresh',
          expiresIn: '15m',
        }),
      });
    }
  });
}

/**
 * Prepares the page for authenticated testing.
 * The global setup already saved storageState with auth tokens.
 * This function sets up route interception and navigates to the dashboard.
 */
export async function login(page: Page): Promise<Page> {
  // Set up route interception to suppress onboarding wizard
  await interceptAuthMe(page);

  // Ensure onboarding is marked complete in localStorage
  await page.addInitScript(() => {
    localStorage.setItem('onboardingCompleted', 'true');
    localStorage.setItem('enabledModules', JSON.stringify([
      'orders', 'invoices', 'products', 'inventory', 'purchases',
      'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
      'customers', 'quotes', 'remitos', 'reports', 'crm',
    ]));
  });

  // Navigate to dashboard
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  return page;
}

/**
 * Wakes up the Render free-tier app.
 */
export async function wakeUpApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90000 });
}

/**
 * Navigates to a page, waiting for network to settle.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

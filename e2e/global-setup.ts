import { chromium, type FullConfig } from '@playwright/test';
import path from 'path';

const TEST_EMAIL = 'e2eplaywright@test.com';
const TEST_PASSWORD = 'PlaywrightE2E2026!';
const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storageState.json');

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'https://gestor-becker-backend.onrender.com';

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept /auth/me to force onboarding_completed=true
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
            email: TEST_EMAIL,
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

  console.log('Global setup: Waking up Render app and logging in...');

  // Navigate to the app (wake up Render)
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Check if we're on the login page
  const emailInput = page.locator('input[type="email"]');
  const isLoginPage = await emailInput.isVisible({ timeout: 30000 }).catch(() => false);

  if (isLoginPage) {
    // Try real login
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL('**/dashboard', { timeout: 20000 });
      console.log('Global setup: Login successful');

      // Mark onboarding complete
      await page.evaluate(() => {
        localStorage.setItem('onboardingCompleted', 'true');
        localStorage.setItem('enabledModules', JSON.stringify([
          'orders', 'invoices', 'products', 'inventory', 'purchases',
          'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
          'customers', 'quotes', 'remitos', 'reports', 'crm',
        ]));
      });

      // Complete onboarding on server
      await page.evaluate(async () => {
        const token = localStorage.getItem('accessToken');
        if (token && !token.startsWith('mock')) {
          try {
            await fetch('/api/onboarding/complete', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
          } catch { /* ignore */ }
        }
      });

      // Reload to clear any onboarding wizard
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    } catch {
      console.log('Global setup: Real login failed, injecting mock session');
      await injectMockSession(page, baseURL);
    }
  } else {
    // Already logged in (redirected to dashboard)
    console.log('Global setup: Already logged in');
    await page.evaluate(() => {
      localStorage.setItem('onboardingCompleted', 'true');
    });
  }

  // Save storage state
  const { mkdirSync } = await import('fs');
  mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });

  console.log('Global setup: Storage state saved');

  await browser.close();
}

async function injectMockSession(page: any, baseURL: string) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.evaluate(() => {
    const user = {
      id: '10ca88dd-a6cf-4a26-8ad1-9a685969d212',
      email: 'demo@test.com',
      name: 'Usuario Demo',
      role: 'admin',
      company_id: '46bc644d-3094-4330-babe-ecaf52559ca5',
    };
    const company = {
      id: '46bc644d-3094-4330-babe-ecaf52559ca5',
      name: 'Test Company',
      cuit: '20123456789',
    };
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('company', JSON.stringify(company));
    localStorage.setItem('accessToken', 'mock-e2e-token');
    localStorage.setItem('refreshToken', 'mock-e2e-refresh');
    localStorage.setItem('permissions', 'null');
    localStorage.setItem('onboardingCompleted', 'true');
    localStorage.setItem('enabledModules', JSON.stringify([
      'orders', 'invoices', 'products', 'inventory', 'purchases',
      'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
      'customers', 'quotes', 'remitos', 'reports', 'crm',
    ]));
  });

  await page.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

export default globalSetup;

export { STORAGE_STATE_PATH };

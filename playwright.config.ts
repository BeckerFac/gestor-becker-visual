import { defineConfig } from '@playwright/test';
import path from 'path';

const STORAGE_STATE_PATH = path.join(__dirname, 'e2e', '.auth', 'storageState.json');

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  workers: 2,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'https://gestor-becker-backend.onrender.com',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

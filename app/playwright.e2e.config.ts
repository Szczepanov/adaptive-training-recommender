/* global process */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  outputDir: 'artifacts/playwright/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/playwright/report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
  projects: [
    { name: 'e2e-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
  ],
});

/* global process */
import { defineConfig, devices } from '@playwright/test';

const appPort = Number(process.env.E2E_APP_PORT) || 4173;
const baseURL = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ||
    (process.env.E2E_APP_PORT
      ? `artifacts/playwright/test-results-${process.env.E2E_APP_PORT}`
      : 'artifacts/playwright/test-results'),
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: process.env.E2E_APP_PORT
          ? `artifacts/playwright/report-${process.env.E2E_APP_PORT}`
          : 'artifacts/playwright/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --mode e2e --host 127.0.0.1 --port ${appPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 45_000,
    env: {
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: process.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || '8080',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: process.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || '9099',
      VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-adaptive-training-e2e',
      VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1',
      VITE_USE_FIREBASE_EMULATORS: process.env.VITE_USE_FIREBASE_EMULATORS || 'true',
    },
  },
  projects: [
    {
      name: 'e2e-chromium',
      testIgnore: '**/mobile/*.pw.ts',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'e2e-mobile',
      testMatch: '**/mobile/*.pw.ts',
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
});

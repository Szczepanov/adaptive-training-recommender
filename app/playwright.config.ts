/* global process */
import { defineConfig, devices } from '@playwright/test';

const visualPort = Number(process.env.VISUAL_APP_PORT) || 4174;
const baseURL = `http://127.0.0.1:${visualPort}`;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.pw.ts',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --mode visual --host 127.0.0.1 --port ${visualPort} --strictPort`,
    url: `${baseURL}/visual.html`,
    reuseExistingServer: process.env.VISUAL_REUSE_SERVER === '1',
    timeout: 30_000,
  },
  projects: [
    { name: 'visual-desktop', use: { ...devices['Desktop Chrome'], browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'visual-mobile-narrow', use: { ...devices['Galaxy S8'], browserName: 'chromium', viewport: { width: 360, height: 800 } } },
    { name: 'visual-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'visual-mobile-wide', use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 412, height: 915 } } },
  ],
});

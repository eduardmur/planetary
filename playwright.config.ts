import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets two checkouts run their browser tests side by side.
const port = Number(process.env.PW_PORT ?? 4178);
const base = `http://localhost:${port}/planetary/`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: base },
  webServer: {
    command: `npx vite preview --configLoader runner --port ${port} --strictPort`,
    url: base,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    {
      name: 'desktop-webkit',
      use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } },
    },
    { name: 'phone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});

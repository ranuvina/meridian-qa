import { defineConfig, devices } from '@playwright/test';

/**
 * Critical dashboard journeys against the running compose stack (web -> API -> Postgres/Redis).
 * The dashboard proxies /api/v1 to the API, so tests only need the web origin.
 *
 * Flake policy: one retry in CI. A test that passes on retry is reported as "flaky" in the
 * HTML/JUnit reports rather than hidden; traces, screenshots and video are kept for failures.
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: isCI ? 2 : undefined,
  retries: isCI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: '../reports/playwright-results',
  reporter: [
    ['list'],
    ['junit', { outputFile: '../reports/junit/e2e.xml' }],
    ['html', { outputFolder: '../reports/playwright-report', open: 'never' }],
    ['json', { outputFile: '../reports/e2e-results.json' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

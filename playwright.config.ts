import { defineConfig, devices } from '@playwright/test';
import { isCi, wantsScreenshots } from './e2e/support/config.js';

/**
 * `playwright test` runs the dashboard tests. The `screenshots` project regenerates the images in
 * docs/assets and is therefore opt-in: it exists only when asked for with
 * `playwright test --project=screenshots` (that is `pnpm docs:screenshots`).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /dashboard\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    ...(wantsScreenshots
      ? [
          {
            name: 'screenshots',
            testMatch: /screenshots\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
  ],
});

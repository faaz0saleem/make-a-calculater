import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These drive the real UI against a real Postgres, so they are kept out of
 * `pnpm test` (which is pure and needs no services) and run with `pnpm e2e`.
 *
 * The suite reseeds before it starts, so it always begins from the known world
 * in `src/db/seed.ts`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Some environments ship a Chromium that does not match the version
          // this Playwright release would download. `PLAYWRIGHT_CHROMIUM_PATH`
          // points at the one that is already there; unset, Playwright uses its
          // own, which is what a normal `pnpm exec playwright install` gives you.
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && pnpm start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});

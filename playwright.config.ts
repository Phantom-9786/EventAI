import { defineConfig } from '@playwright/test';

/**
 * E2E smoke tests against the running stack (web :3000, API :4000).
 * `reuseExistingServer: true` attaches to an already-running dev server.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_REUSE
    ? undefined
    : {
        command: 'npm run dev --filter=@eventai/web',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});

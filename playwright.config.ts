import { defineConfig } from '@playwright/test';

/**
 * E2E smoke tests against the running stack (web :3000, API :4000).
 * `reuseExistingServer: true` attaches to an already-running dev server.
 */
const fixtureApi = process.env.E2E_PUBLIC_PAGE_FIXTURES
  ? {
      command: 'node e2e/public-page-fixture-server.cjs',
      url: 'http://localhost:4100/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    }
  : null;

const webServer = process.env.E2E_REUSE
  ? undefined
  : fixtureApi
    ? [
        fixtureApi,
        {
          command: 'npm run dev --filter=@eventai/web',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120_000,
          env: { ...process.env, NEXT_PUBLIC_API_URL: 'http://localhost:4100/api' },
        },
      ]
    : [
        {
          command: 'npm run dev --filter=@eventai/api',
          url: 'http://localhost:4000/api/health',
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: 'npm run dev --filter=@eventai/web',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ];

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
  webServer,
});

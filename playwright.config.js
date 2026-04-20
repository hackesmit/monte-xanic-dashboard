import { defineConfig } from '@playwright/test';

// Mobile-responsive E2E harness. Intentionally isolated from the node:test
// MT suite (which lives in tests/*.test.mjs) via testDir.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:8080',
    actionTimeout: 8_000,
    navigationTimeout: 12_000,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

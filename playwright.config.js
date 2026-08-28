import { defineConfig } from '@playwright/test';

// Mobile-responsive E2E harness. Intentionally isolated from the node:test
// MT suite (which lives in tests/*.test.mjs) via testDir.
//
// Port 8099 is dedicated to this harness. It used to be 8080, which collides
// with common dev tooling (code-server et al); combined with
// `reuseExistingServer` that made Playwright silently drive whatever process
// already held the port, and every test failed on a timeout that looked like
// an app bug. `--strictPort` makes Vite abort instead of drifting to another
// port, so a collision now surfaces as a clear startup error.
const PORT = Number(process.env.PW_PORT || 8099);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 8_000,
    navigationTimeout: 12_000,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

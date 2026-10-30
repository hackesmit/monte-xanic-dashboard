// Loading skeleton: a 6-card text-free KPI placeholder replaces the spinner.
// The /api/datos route is held open so the skeleton stays on screen.

import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 900 } });

async function holdLoading(page) {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'admin');
    } catch (_) { /* ignore */ }
  });
  await page.route('**/api/**', () => new Promise(() => {}));
  await page.route('**/rest/v1/**', () => new Promise(() => {}));
}

test('skeleton shows 6 text-free cards while data is pending', async ({ page }, testInfo) => {
  await holdLoading(page);
  await page.goto('/');
  const root = page.locator('#loading-spinner');
  await expect(root.locator('.kpi-skel')).toHaveCount(6);
  expect((await root.innerText()).trim()).toBe('');
  await expect(root.locator('.kpi-skel').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('skeleton.png') });
});

test('pulse stops under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await holdLoading(page);
  await page.goto('/');
  const name = await page.locator('.kpi-skel').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('none');
});

test('pulse runs when motion is allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await holdLoading(page);
  await page.goto('/');
  const name = await page.locator('.kpi-skel').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('kpi-skel-pulse');
});

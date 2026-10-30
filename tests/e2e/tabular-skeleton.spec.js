// tests/e2e/tabular-skeleton.spec.js
// hq-ik6v0.6: tabular numerals on .data-table cells, and the skeleton KPI row
// shown while data loads instead of the full-page spinner.

import { test, expect } from '@playwright/test';

async function boot(page, context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
    } catch (_) { /* ignore */ }
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
}

test('a .data-table td renders 1111 and 0000 at the same width', async ({ page, context }) => {
  await boot(page, context);
  const widths = await page.evaluate(() => {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.style.cssText = 'position:absolute;left:0;top:0;width:auto';
    table.innerHTML = '<tbody><tr><td><span>1111</span></td><td><span>0000</span></td></tr></tbody>';
    document.body.appendChild(table);
    const w = [...table.querySelectorAll('span')].map(s => s.getBoundingClientRect().width);
    const variant = getComputedStyle(table.querySelector('td')).fontVariantNumeric;
    table.remove();
    return { w, variant };
  });
  expect(widths.variant).toContain('tabular-nums');
  expect(widths.w[0]).toBeGreaterThan(0);
  expect(widths.w[0]).toBeCloseTo(widths.w[1], 3);
});

test('while data loads the page shows six gray KPI cards and no text', async ({ page, context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
    } catch (_) { /* ignore */ }
  });
  // Hold every data request so the loading state stays up.
  await page.route('**/api/**', () => new Promise(() => {}));
  await page.route('**/rest/v1/**', () => new Promise(() => {}));
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const loader = page.locator('#loading-spinner');
  await expect(loader).toBeVisible();
  await expect(loader.locator('.kpi-skel-card')).toHaveCount(6);
  expect((await loader.innerText()).trim()).toBe('');
  await page.screenshot({ path: 'test-results/kpi-skeleton.png' });
});

test('the skeleton pulse stops under prefers-reduced-motion', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', () => new Promise(() => {}));
  await page.route('**/rest/v1/**', () => new Promise(() => {}));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const name = await page.locator('.kpi-skel-card').first()
    .evaluate(el => getComputedStyle(el).animationName);
  expect(name).toBe('none');
});

test('the skeleton pulses when motion is allowed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/**', () => new Promise(() => {}));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const name = await page.locator('.kpi-skel-card').first()
    .evaluate(el => getComputedStyle(el).animationName);
  expect(name).toBe('kpi-skel-pulse');
});

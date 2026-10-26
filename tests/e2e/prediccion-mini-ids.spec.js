// xd-bj1: Prediccion mini-charts used to share a canvas id per variety+valley,
// so Charts.instances destroyed the previous card's chart and left it blank.
// Harness notes (auth bypass under vite dev) are in mobile-responsive.spec.js.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function boot(page, context) {
  await context.addInitScript(() => {
    localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
    localStorage.setItem('xanic_user_role', 'admin');
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.click('#demo-toggle-btn');
  await page.waitForTimeout(1800);
  await page.click('.nav-tab[data-view="prediccion"]');
  await page.waitForSelector('#prediccion-grid .pred-card canvas', { timeout: 8_000 });
  await page.waitForTimeout(800);
}

const probe = () => {
  const canvases = [...document.querySelectorAll('#prediccion-grid .pred-mini canvas')];
  const ids = canvases.map(c => c.id);
  return import('/js/charts.js').then(({ Charts }) => ({
    total: canvases.length,
    unique: new Set(ids).size,
    blank: canvases.filter(c => !Charts.instances[c.id] || Charts.instances[c.id].canvas !== c).length,
    instances: Object.keys(Charts.instances).length,
  }));
};

test('every Prediccion mini canvas has a unique id and a live chart', async ({ page, context }) => {
  await boot(page, context);
  const a = await page.evaluate(probe);
  expect(a.total).toBeGreaterThan(10);
  expect(a.unique).toBe(a.total);
  expect(a.blank).toBe(0);
  await page.screenshot({ path: 'test-results/prediccion-mini.png', fullPage: true });
});

test('re-rendering Prediccion does not leak chart instances', async ({ page, context }) => {
  await boot(page, context);
  const before = await page.evaluate(probe);
  await page.evaluate(async () => {
    const { PredictionView } = await import('/js/predictionView.js');
    PredictionView.render();
    PredictionView.render();
  });
  await page.waitForTimeout(800);
  const after = await page.evaluate(probe);
  expect(after.instances).toBe(before.instances);
  expect(after.blank).toBe(0);
});

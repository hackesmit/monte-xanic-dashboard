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

// xd-e2y: a past vintage whose Brix slope is impossible is dropped from the
// prior, and the card says so instead of looking like a lot with no history.
test('a corrupt past vintage shows a data-quality line on its card', async ({ page, context }) => {
  await boot(page, context);
  const shown = await page.evaluate(async () => {
    const { DataStore } = await import('/js/dataLoader.js');
    const { PredictionView } = await import('/js/predictionView.js');
    const rows = DataStore.berryData;
    const ref = rows.find(r => r.variety && r.appellation && Number.isFinite(Number(r.brix)));
    const years = rows.map(r => r.vintage).filter(Number.isFinite);
    const corruptYear = Math.min(...years) - 1;
    for (let d = 0; d < 5; d++) {
      rows.push({ ...ref, vintage: corruptYear,
        sampleDate: new Date(Date.UTC(corruptYear, 7, 1 + 5 * d)).toISOString().slice(0, 10),
        brix: 18 + 100 * 5 * d });
    }
    PredictionView.render();
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('#prediccion-grid .pred-card-flags li')]
      .map(li => li.textContent).filter(t => t.includes('descartados'));
  });
  expect(shown.length).toBe(1);
  expect(shown[0]).toContain('Brix: 1');
  const card = page.locator('#prediccion-grid .pred-card', { hasText: 'descartados' });
  await card.screenshot({ path: 'test-results/prediccion-descartados.png' });
});

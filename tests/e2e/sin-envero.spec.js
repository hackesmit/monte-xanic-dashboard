// Bayas tab: a lot with no envero date is shown, not hidden. Bead xd-ayv.
//
// tests/mt60-sin-envero.test.mjs proves the pure column placement; this proves
// the maturity charts actually draw it. The berry rows mirror production on
// 2026-10-26: 26GRENVA3A is one of the nine 2026 lots whose Seguimiento
// workbook carries no Fecha de envero (days_post_crush null), next to a lot
// that has one. Before xd-ayv the undated lot reached the KPIs and the table
// but no timeline chart.
//
// Run: npm run test:e2e -- sin-envero

import { test, expect } from '@playwright/test';

const fila = (id, sample_id, sample_date, days_post_crush, brix, variety) => ({
  id, sample_id, sample_type: 'Berries', sample_date, sample_seq: 1,
  vintage_year: 2026, variety, appellation: 'Viña Alta (VON)',
  crush_date: days_post_crush === null ? null : '2026-07-20',
  days_post_crush, brix, ph: 3.4, ta: 6.1, tant: null, berry_weight: 1.4,
  below_detection: false,
});

const WINE_SAMPLES = [
  fila(1, '26CSVA1A', '2026-07-30', 10, 18.2, 'Cabernet Sauvignon'),
  fila(2, '26CSVA1A', '2026-08-09', 20, 21.5, 'Cabernet Sauvignon'),
  fila(3, '26GRENVA3A', '2026-08-03', null, 19.4, 'Grenache'),
  fila(4, '26GRENVA3A', '2026-08-10', null, 21.0, 'Grenache'),
];

async function abrir(page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_theme', 'dark');
      localStorage.setItem('xanic_dev_supabase_url', 'https://e2e.supabase.co');
      localStorage.setItem('xanic_dev_supabase_key', 'e2e-anon-key');
    } catch (_) { /* ignore */ }
  });
  // Catch-all FIRST, the specific wine_samples route LAST: Playwright matches
  // the most recently registered route first.
  await page.route('**/rest/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'content-range': '0-0/0' }, body: '[]',
  }));
  await page.route('**/rest/v1/wine_samples*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'content-range': `0-${WINE_SAMPLES.length - 1}/${WINE_SAMPLES.length}` },
    body: JSON.stringify(WINE_SAMPLES),
  }));
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  // Boot renders once before the rows arrive; wait for the render that has them.
  // (waitForFunction does not await an async predicate, so poll by hand.)
  for (let intento = 0; intento < 120; intento++) {
    const listo = await page.evaluate(async (n) => {
      const { Charts } = await import('/js/charts.js');
      const { DataStore } = await import('/js/dataLoader.js');
      return DataStore.berryData?.length === n && (Charts.instances.chartBrix?.data.datasets.length ?? 0) >= 2;
    }, WINE_SAMPLES.length);
    if (listo) return;
    await page.waitForTimeout(100);
  }
  throw new Error('chartBrix never rendered the mocked berry rows');
}

// What a chart instance holds, read through the app's own Charts module (same
// module URL as the app, so the same instance).
// A refresh destroys and rebuilds a chart, so poll until a live instance is
// there to read.
async function leer(page, canvasId) {
  for (let intento = 0; intento < 40; intento++) {
    const r = await page.evaluate(async (id) => {
      const { Charts } = await import('/js/charts.js');
      const chart = Charts.instances[id];
      if (!chart || !chart.scales?.x) return null;
      const x = chart.scales.x;
      return {
        datasets: chart.data.datasets.map(ds => ({
          label: ds.label,
          sinEnvero: !!ds._sinEnvero,
          points: ds.data.map(p => ({ x: p.x, y: p.y, sampleId: p.sampleId, sinEnvero: !!p._sinEnvero, sampleDate: p.sampleDate ?? null })),
        })),
        tickLabels: x.ticks.map(t => String(t.label ?? t.value)),
        legend: chart.legend.legendItems.map(i => i.text),
      };
    }, canvasId);
    if (r) return r;
    await page.waitForTimeout(100);
  }
  return null;
}

test.describe('Lotes sin fecha de envero', () => {
  test('the Brix timeline shows the undated lot in a Sin envero column', async ({ page }) => {
    await abrir(page);
    const brix = await leer(page, 'chartBrix');
    expect(brix).not.toBeNull();

    const fechados = brix.datasets.filter(d => !d.sinEnvero).flatMap(d => d.points);
    const sin = brix.datasets.filter(d => d.sinEnvero).flatMap(d => d.points);

    // The dated lot is on the timeline as before.
    expect(fechados.map(p => p.sampleId).sort()).toEqual(['26CSVA1A', '26CSVA1A']);
    // Both readings of the undated lot are drawn, with their real values and
    // sample dates, left of every dated point.
    expect(sin.map(p => p.y).sort()).toEqual([19.4, 21]);
    expect(sin.every(p => p.sampleId === '26GRENVA3A' && p.sinEnvero)).toBe(true);
    expect(sin.map(p => p.sampleDate).sort()).toEqual(['2026-08-03', '2026-08-10']);
    const minFechado = Math.min(...fechados.map(p => p.x));
    expect(sin.every(p => p.x < minFechado - 4)).toBe(true);

    // The column is labelled, and the legend carries one entry per variety.
    expect(brix.tickLabels[0]).toBe('Sin envero');
    expect(brix.legend.sort()).toEqual(['Cabernet Sauvignon', 'Grenache']);

    await page.locator('#chartBrix').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/sin-envero-brix.png', clip: await page.locator('#chartBrix').boundingBox() });
  });

  test('every maturity timeline gets the column', async ({ page }) => {
    await abrir(page);
    for (const id of ['chartBrix', 'chartPH', 'chartTA']) {
      const c = await leer(page, id);
      const sin = c.datasets.filter(d => d.sinEnvero).flatMap(d => d.points);
      expect(sin.length, id).toBe(2);
      expect(c.tickLabels[0], id).toBe('Sin envero');
    }
  });

  test('the evolution chart keeps the undated lot, unjoined to any line', async ({ page }) => {
    await abrir(page);
    await page.evaluate(async () => {
      const { Charts } = await import('/js/charts.js');
      Charts.updateEvolutionChart();
    });
    const evo = await leer(page, 'chartEvolution');
    expect(evo).not.toBeNull();
    // Evolution lines are keyed by the lot code without its vintage prefix.
    const gren = evo.datasets.filter(d => d.label.startsWith('GRENVA3A '));
    expect(gren.length).toBeGreaterThan(0);
    const pts = gren.flatMap(d => d.points);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every(p => p.sinEnvero)).toBe(true);
    expect(evo.tickLabels[0]).toBe('Sin envero');
  });
});

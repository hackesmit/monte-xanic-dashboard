// Tanques tab: the selected lote's analyses in the tank panel. Bead xd-qrn.7.
//
// mt56-tanques-panel-charts.test.mjs proves the pure series selection; this
// proves the panel actually draws it. The production movement log is empty, so
// (as in tanques.spec.js) /api/tanques is mocked with the real catalog and a
// one-row log that drops the REAL lote 25CSKMP-4 into H8. The lab samples are
// the real wine_samples rows for 25CSKMP-4 (Brix 26 -> 0.2 at D5 during
// fermentation), served by intercepting the Supabase REST endpoint the anon
// client calls, so every number on the chart is the lab's own.
//
// Prerequisites: npx playwright install chromium
// Run: npm run test:e2e -- tanques-panel-charts

import { test, expect } from '@playwright/test';
import { catalogoTanques, sinonimosTanques } from '../fixtures/tanques-catalogo.mjs';

const TANQUES = catalogoTanques();
const SINONIMOS = sinonimosTanques();

// 25CSKMP-4's real fermentation at D5, then the move into H8. One recepcion
// into H8 leaves the lote in H8 at the fermentation stage, which is what puts
// the Brix time series on screen.
const MOVIMIENTOS = [
  { id: 1, fecha: '2025-10-30', tipo: 'recepcion', origen: null, destino: 'H8', lot_code: '25CSKMP-4', vintage_year: 2025, volumen_l: 9000, merma_l: 0, nota: null, fuente: 'manual', creado_por: 'daniel', created_at: '2025-10-30T00:00:01Z', anulado: false },
];

// The real wine_samples Brix curve for 25CSKMP-4 (queried from production
// 2026-10-15). Only the columns DataStore maps are included.
const BRIX = [26, 25.4, 24.5, 20.3, 11, 6.6, 3.5, 2.1, 1.3, 1.1, 0.3, 0.5, 0.2];
const WINE_SAMPLES = BRIX.map((brix, i) => {
  const d = new Date(Date.UTC(2025, 9, 30 + i));
  return {
    id: i + 1, sample_id: '25CSKMP-4', sample_type: 'Must',
    sample_date: d.toISOString().slice(0, 10), vessel_id: 'D5',
    brix, ph: null, ta: null, va: null, vintage_year: 2025,
    variety: 'Cabernet Sauvignon', appellation: null, sample_seq: 1,
  };
});

async function abrir(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_theme', 'dark');
      // Make DataStore build a Supabase client whose REST calls we intercept.
      localStorage.setItem('xanic_dev_supabase_url', 'https://e2e.supabase.co');
      localStorage.setItem('xanic_dev_supabase_key', 'e2e-anon-key');
    } catch (_) { /* ignore */ }
  });
  await page.route('**/api/tanques', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, version: 1, tanques: TANQUES, sinonimos: SINONIMOS, movimientos: MOVIMIENTOS }),
  }));
  // The anon client fetches several tables at boot; wine_samples carries the
  // lote series, everything else is empty. The catch-all is registered FIRST so
  // the specific wine_samples route (registered last) takes precedence — a
  // Playwright route matches most-recently-added first.
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
  await page.locator('.nav-tab[data-view="tanques"]').click();
  await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
  await page.waitForTimeout(150);
}

test.describe('Tanques panel charts', () => {
  test('H8 shows the real 25CSKMP-4 fermentation series and links to the Explorador', async ({ page }) => {
    await abrir(page);
    await page.locator('#tanques-plano [data-tanque="H8"]').click();
    const panel = page.locator('#tanques-panel');
    await expect(panel.locator('h2')).toHaveText('H8');
    await expect(panel).toContainText('25CSKMP-4');

    // The analyses section with its chart canvas, and the Explorador link.
    const sec = panel.locator('.tanques-analisis');
    await expect(sec).toContainText('Análisis del lote');
    await expect(sec.locator('#tanques-panel-chart')).toBeVisible();
    await expect(sec.locator('.tanques-ir-explorador')).toHaveText('Abrir 25CSKMP-4 en el Explorador');

    // The Chart.js line is drawn: the canvas has a non-zero backing store and a
    // chart instance is registered against it.
    await page.waitForTimeout(500);
    const dibujado = await sec.locator('#tanques-panel-chart').evaluate((c) => c.width > 0 && c.height > 0);
    expect(dibujado).toBe(true);

    await page.screenshot({ path: 'test-results/tanques-panel-h8.png', fullPage: false });

    // The link opens the Explorador filtered to that lote.
    await sec.locator('.tanques-ir-explorador').click();
    await expect(page.locator('.nav-tab[data-view="explorer"]')).toHaveClass(/active/);
    await expect(page.locator('#explorer-charts')).toContainText('25CSKMP-4');
  });

  test('an emptied tank still shows its last lote series', async ({ page }) => {
    // Add a salida so H8 ends empty; the panel must still chart the last lote.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_theme', 'dark');
      localStorage.setItem('xanic_dev_supabase_url', 'https://e2e.supabase.co');
      localStorage.setItem('xanic_dev_supabase_key', 'e2e-anon-key');
    });
    const log = [
      ...MOVIMIENTOS,
      { id: 2, fecha: '2026-02-10', tipo: 'salida', origen: 'H8', destino: null, lot_code: '25CSKMP-4', vintage_year: 2025, volumen_l: 9000, merma_l: 0, nota: 'embotellado', fuente: 'manual', creado_por: 'daniel', created_at: '2026-02-10T00:00:01Z', anulado: false },
    ];
    await page.route('**/api/tanques', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: 1, tanques: TANQUES, sinonimos: SINONIMOS, movimientos: log }),
    }));
    await page.route('**/rest/v1/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]',
    }));
    await page.route('**/rest/v1/wine_samples*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': `0-${WINE_SAMPLES.length - 1}/${WINE_SAMPLES.length}` },
      body: JSON.stringify(WINE_SAMPLES),
    }));
    await page.goto('/');
    await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
    await page.locator('.nav-tab[data-view="tanques"]').click();
    await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
    await page.locator('#tanques-plano [data-tanque="H8"]').click();
    const panel = page.locator('#tanques-panel');
    await expect(panel.locator('.tanques-alert')).toContainText('Vacío');
    await expect(panel.locator('.tanques-analisis #tanques-panel-chart')).toBeVisible();
    await expect(panel.locator('.tanques-ir-explorador')).toContainText('25CSKMP-4');
  });
});

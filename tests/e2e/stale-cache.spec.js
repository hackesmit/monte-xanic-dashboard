import { test, expect } from '@playwright/test';

// xd-eb2: a returning user whose cache is warm while Supabase fails must see a
// persistent stale-data banner carrying the cache date, and a badge that is
// not green. Before the fix the badge went green on client existence alone.

// Two days old, never a fixed date: loadCache drops a cache older than 7 days,
// so a fixed 19 Oct stamp turned this test red on 26 Oct.
const CACHE_TS = Date.now() - 2 * 24 * 60 * 60 * 1000;
const CACHE_DIA = new Date(CACHE_TS).toLocaleString('es-MX', { day: 'numeric', month: 'short' });
const CACHE = {
  berry: [{ sampleId: '25CSKMP-4', sampleDate: '2025-08-20', variety: 'Cabernet Sauvignon', appellation: 'Kompali (VDG)', brix: 23.4, vintage: 2025, lotCode: 'CSKMP-4', grapeType: 'red' }],
  wineR: [], wineP: [], recs: [], recL: [],
  ts: CACHE_TS,
};

async function abrir(page, supabase) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((cache) => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_theme', 'dark');
      localStorage.setItem('xanic_dev_supabase_url', 'https://e2e.supabase.co');
      localStorage.setItem('xanic_dev_supabase_key', 'e2e-anon-key');
      localStorage.setItem('xanic_data_cache', JSON.stringify(cache));
    } catch (_) { /* ignore */ }
  }, CACHE);
  await page.route('**/api/config', (route) => route.fulfill({ status: 503, body: 'down' }));
  // Lab tables are read through /api/datos, never rest/v1 (xd-0lt.1).
  await page.route('**/api/datos?*', supabase);
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
}

test.describe('Stale cache indicator', () => {
  test('Supabase failing over a warm cache: banner with the cache date, badge not green', async ({ page }) => {
    await abrir(page, (route) => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'sesión expirada' }),
    }));
    const banner = page.locator('#stale-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`datos en caché del ${CACHE_DIA}`);
    const badge = page.locator('#db-status-badge');
    await expect(badge).toHaveClass(/db-badge-stale/);
    await expect(badge).not.toHaveClass(/db-badge-ok/);
    // Persistent: still there well after the old 6 s toast would have faded.
    await page.waitForTimeout(7_000);
    await expect(banner).toBeVisible();
    await page.screenshot({ path: 'test-results/stale-cache-banner.png' });
  });

  test('Supabase answering an empty table over a warm cache: live, no banner', async ({ page }) => {
    await abrir(page, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, filas: [] }),
    }));
    await expect(page.locator('#db-status-badge')).toHaveClass(/db-badge-ok/);
    await expect(page.locator('#stale-banner')).toBeHidden();
  });

  // xd-vqe: a reconnect reruns every loader, and the banner clears only after.
  test('Supabase back after a failed boot: the online event restores live data and all loaders', async ({ page }) => {
    let caido = true;
    const tablas = [];
    await abrir(page, (route) => {
      const tabla = new URL(route.request().url()).searchParams.get('tabla');
      if (caido) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'caído' }) });
      tablas.push(tabla);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, filas: [] }) });
    });
    // Meteorology is read with the anon client (rest/v1), not /api/datos.
    let meteo = 0;
    await page.route('https://e2e.supabase.co/rest/v1/meteorology*', (route) => {
      meteo++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    const banner = page.locator('#stale-banner');
    await expect(banner).toBeVisible();
    const meteoAntes = meteo;
    caido = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#db-status-badge')).toHaveClass(/db-badge-ok/);
    await expect(banner).toBeHidden();
    for (const t of ['wine_samples', 'mediciones_tecnicas', 'harvest_target_overrides']) {
      expect(tablas, `${t} not reloaded after reconnect`).toContain(t);
    }
    expect(meteo, 'meteorology not reloaded after reconnect').toBeGreaterThan(meteoAntes);
    await page.screenshot({ path: 'test-results/stale-cache-reconnected.png' });
  });
});

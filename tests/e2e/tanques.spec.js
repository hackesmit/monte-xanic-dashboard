// Tanques tab, end to end. Bead xd-qrn.4.
//
// mt53-tanques-plan.test.mjs proves the geometry; this proves the tab actually
// renders it, in both themes and at phone width, and that the colour modes,
// the search and the tank panel read from the derived state.
//
// /api/tanques is a Vercel function and is unreachable under `vite dev`, so it
// is intercepted here with the REAL catalog (parsed out of the migration) and a
// mock movement log. The production log is empty today, so a mock is the only
// way to see a tank with wine in it; every number on screen still comes from
// js/tanques/estado.js replaying that log.
//
// Prerequisites: npx playwright install chromium
// Run: npm run test:e2e -- tanques

import { test, expect } from '@playwright/test';
import { catalogoTanques, sinonimosTanques } from '../fixtures/tanques-catalogo.mjs';

const TANQUES = catalogoTanques();
const SINONIMOS = sinonimosTanques();

let seq = 0;
function mv(o) {
  seq += 1;
  return {
    id: seq,
    fecha: '2025-09-01',
    tipo: 'trasiego',
    origen: null,
    destino: null,
    lot_code: null,
    vintage_year: 2025,
    volumen_l: 0,
    merma_l: 0,
    nota: null,
    fuente: 'manual',
    creado_por: 'daniel',
    created_at: `2025-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    anulado: false,
    ...o,
  };
}

// A log that exercises every panel section: receptions, a four-stop lote route,
// a descube that moves the stage on, a blend in C5, an annulled row and a
// bottling salida.
const MOVIMIENTOS = [
  mv({ fecha: '2025-09-02', tipo: 'recepcion', destino: 'A1', lot_code: '25SBVDG-1', volumen_l: 6900 }),
  mv({ fecha: '2025-09-10', tipo: 'recepcion', destino: 'A2', lot_code: '25CHVA-1', volumen_l: 7000 }),
  mv({ fecha: '2025-10-02', tipo: 'recepcion', destino: 'A5', lot_code: '25MEKMP-1', volumen_l: 14200 }),
  mv({ fecha: '2025-10-12', tipo: 'recepcion', destino: 'D5', lot_code: '25DUKMP-3', volumen_l: 4200, fuente: 'lab' }),
  mv({ fecha: '2025-10-18', tipo: 'trasiego', origen: 'D5', destino: 'D1', lot_code: '25DUKMP-3', volumen_l: 4200, merma_l: 100, fuente: 'lab' }),
  mv({ fecha: '2025-10-21', tipo: 'trasiego', origen: 'D1', destino: 'E5', lot_code: '25DUKMP-3', volumen_l: 4100, merma_l: 100, fuente: 'lab' }),
  mv({ fecha: '2025-10-23', tipo: 'trasiego', origen: 'E5', destino: 'B4', lot_code: '25DUKMP-3', volumen_l: 4000, merma_l: 200, nota: 'trasiego con aireación', fuente: 'lab' }),
  mv({ fecha: '2025-10-30', tipo: 'recepcion', destino: 'C3', lot_code: '25CSKMP-6', volumen_l: 18000 }),
  mv({ fecha: '2025-11-04', tipo: 'descube', origen: 'C3', destino: 'C2', lot_code: '25CSKMP-6', volumen_l: 18000, merma_l: 300 }),
  mv({ fecha: '2025-11-10', tipo: 'recepcion', destino: 'C5', lot_code: '25MEKMP-3', volumen_l: 12700 }),
  mv({ fecha: '2025-12-04', tipo: 'ensamble', origen: 'A5', destino: 'C5', lot_code: '25MEKMP-1', volumen_l: 5400, merma_l: 50 }),
  mv({ fecha: '2025-12-06', tipo: 'trasiego', origen: 'A2', destino: 'G3', lot_code: '25CHVA-1', volumen_l: 7000, anulado: true }),
  mv({ fecha: '2026-01-15', tipo: 'salida', origen: 'A1', lot_code: '25SBVDG-1', volumen_l: 6900, nota: 'embotellado' }),
];

async function abrir(page, { ancho = 1300, alto = 1000, tema = 'dark' } = {}) {
  await page.setViewportSize({ width: ancho, height: alto });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_theme', t);
    } catch (_) { /* ignore */ }
  }, tema);
  await page.route('**/api/tanques', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, version: 1, tanques: TANQUES, sinonimos: SINONIMOS, movimientos: MOVIMIENTOS }),
  }));
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.locator('.nav-tab[data-view="tanques"]').click();
  await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
  await page.waitForTimeout(150);
}

test.describe('Tanques', () => {
  test('draws the whole floor with no overlapping lids', async ({ page }) => {
    await abrir(page);
    const tanques = page.locator('#tanques-plano .tanque');
    await expect(tanques).toHaveCount(72);   // 68 rows A-H + R1 R2 PD-1 PD-2

    const codigos = await page.$$eval('#tanques-plano .tanque', (g) => g.map((x) => x.dataset.tanque));
    for (const c of ['A1', 'H11', 'F10', 'R1', 'R2', 'PD-1', 'PD-2', 'E7', 'C5']) {
      expect(codigos).toContain(c);
    }
    // Rows A-H plus the two reception rows, letters drawn in the gutter.
    const letras = await page.$$eval('#tanques-plano text', (t) =>
      t.map((x) => x.textContent).filter((s) => /^[A-H]$/.test(s)));
    expect(letras.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);

    // The lids are what a user clicks; two that intersect hide a tank.
    const choques = await page.$$eval('#tanques-plano .tanque .tanque-tapa', (lids) => {
      const b = lids.map((l) => ({
        c: l.closest('[data-tanque]').dataset.tanque,
        cx: +l.getAttribute('cx'), cy: +l.getAttribute('cy'),
        rx: +l.getAttribute('rx'), ry: +l.getAttribute('ry'),
      }));
      const out = [];
      for (let i = 0; i < b.length; i++) {
        for (let j = i + 1; j < b.length; j++) {
          const dx = (b[i].cx - b[j].cx) / (b[i].rx + b[j].rx);
          const dy = (b[i].cy - b[j].cy) / (b[i].ry + b[j].ry);
          if (dx * dx + dy * dy < 1) out.push(`${b[i].c}/${b[j].c}`);
        }
      }
      return out;
    });
    expect(choques).toEqual([]);

    // Height reads capacity: E7 holds 1 400 L, C1 holds 18 700 L.
    const alturas = await page.$$eval('#tanques-plano .tanque', (gs) => {
      const h = {};
      for (const g of gs) {
        const lid = g.querySelector('.tanque-tapa');
        const base = g.querySelector('ellipse:not(.tanque-tapa)');
        h[g.dataset.tanque] = +base.getAttribute('cy') - +lid.getAttribute('cy');
      }
      return h;
    });
    expect(alturas.C1).toBeGreaterThan(alturas.E7);
    expect(alturas.H3).toBeGreaterThan(alturas.A3);
  });

  test('the tank panel reads the derived contents, not the raw log', async ({ page }) => {
    await abrir(page);
    // C5 is the blend: 12 700 L of 25MEKMP-3 plus 5 350 L arriving from A5.
    await page.locator('#tanques-plano [data-tanque="C5"]').click();
    const panel = page.locator('#tanques-panel');
    await expect(panel.locator('h2')).toHaveText('C5');
    await expect(panel).toContainText('25MEKMP-3');
    await expect(panel).toContainText('25MEKMP-1');
    await expect(panel).toContainText('Ensamble');
    await expect(panel).toContainText('Merlot');
    // 12 700 + (5 400 - 50) = 18 050 L of an 18 700 L tank.
    await expect(panel).toContainText('18,050 L');
    await expect(panel).toContainText('97%');

    // B4 is the end of the lote route D5 -> D1 -> E5 -> B4, every step from lab.
    await page.locator('#tanques-plano [data-tanque="B4"]').click();
    await expect(panel.locator('h2')).toHaveText('B4');
    const paradas = await panel.locator('.tanques-route-stop').allTextContents();
    expect(paradas).toEqual(['D5', 'D1', 'E5', 'B4']);
    await expect(panel.locator('.tanques-route-stop.cur')).toHaveText('B4');
    await expect(panel.locator('.tanques-tag.lab').first()).toBeVisible();

    // A route stop navigates: clicking D1 selects it.
    await panel.locator('.tanques-route-stop', { hasText: 'D1' }).click();
    await expect(panel.locator('h2')).toHaveText('D1');

    // A1 was bottled out, so it is empty and says since when.
    await page.locator('#tanques-plano [data-tanque="A1"]').click();
    await expect(panel.locator('.tanques-alert')).toContainText('Vacío desde el 15 ene 26');
    await expect(panel.locator('.tanques-alert')).toContainText('25SBVDG-1');

    // A2's only outgoing movement is annulled, so it still holds its wine and
    // the history shows the annulled row rather than hiding the undo.
    await page.locator('#tanques-plano [data-tanque="A2"]').click();
    await expect(panel).toContainText('Chardonnay');
    await expect(panel.locator('.tanques-timeline li.anulado')).toHaveCount(1);
  });

  test('the colour modes repaint the bands and the legend', async ({ page }) => {
    await abrir(page);
    const banda = page.locator('#tanques-plano [data-tanque="C2"] path[style*="--tank-"]').last();
    await expect(banda).toHaveAttribute('style', /--tank-v-cs/);
    await expect(page.locator('#tanques-leyenda')).toContainText('Cabernet Sauvignon');

    await page.locator('#tanques-modos button[data-modo="etapa"]').click();
    await expect(banda).toHaveAttribute('style', /--tank-s-des/);
    await expect(page.locator('#tanques-leyenda')).toContainText('Descube');
    await expect(page.locator('#tanques-modos button[data-modo="etapa"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#tanques-modos button[data-modo="ocupacion"]').click();
    await expect(banda).toHaveAttribute('style', /--tank-ocu-/);
    await expect(page.locator('#tanques-leyenda')).toContainText('Lleno');

    await page.locator('#tanques-modos button[data-modo="variedad"]').click();
    await expect(banda).toHaveAttribute('style', /--tank-v-cs/);
  });

  test('search dims what does not match and jumps to the hit', async ({ page }) => {
    await abrir(page);
    await page.locator('#tanques-buscar').fill('25DUKMP-3');
    await expect(page.locator('#tanques-plano .tanque.dim')).toHaveCount(71);
    await expect(page.locator('#tanques-plano [data-tanque="B4"]')).not.toHaveClass(/dim/);
    await expect(page.locator('#tanques-panel h2')).toHaveText('B4');

    await page.locator('#tanques-buscar').fill('H1');
    // H1, H10 and H11 all contain 'h1'.
    await expect(page.locator('#tanques-plano .tanque:not(.dim)')).toHaveCount(3);

    await page.locator('#tanques-buscar').fill('');
    await expect(page.locator('#tanques-plano .tanque.dim')).toHaveCount(0);
  });

  test('the unlocated vessels are trayed, grouped, and never lost', async ({ page }) => {
    await abrir(page);
    const bandeja = page.locator('#tanques-otras');
    await expect(bandeja).toContainText('I-4 CAVA');
    await expect(bandeja).toContainText('Tibores (21)');
    await expect(bandeja).toContainText('Tanques Domecq (7)');
    await expect(bandeja).toContainText('Kegs (11)');
  });

  test('the whole plan is visible on a 1300px laptop', async ({ page }) => {
    // The sidebar takes about 334px, so at 1300 the side panel has to stack or
    // the plan is cut off at its 680px minimum. This is the guard on that
    // breakpoint: a plan you can only see two thirds of is the regression.
    await abrir(page, { ancho: 1300 });
    const caja = await page.locator('.tanques-plan-scroll').evaluate((el) => ({
      cliente: el.clientWidth, contenido: el.scrollWidth,
    }));
    expect(caja.contenido).toBeLessThanOrEqual(caja.cliente);
    const plan = await page.locator('.tanques-plan-card').boundingBox();
    const panel = await page.locator('.tanques-panel').boundingBox();
    expect(panel.y).toBeGreaterThan(plan.y);

    // At 1440 the panel fits beside the plan and the plan still does not scroll.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(200);
    const ancho = await page.locator('.tanques-plan-scroll').evaluate((el) => ({
      cliente: el.clientWidth, contenido: el.scrollWidth,
    }));
    expect(ancho.contenido).toBeLessThanOrEqual(ancho.cliente);
    const plan2 = await page.locator('.tanques-plan-card').boundingBox();
    const panel2 = await page.locator('.tanques-panel').boundingBox();
    expect(panel2.x).toBeGreaterThan(plan2.x + plan2.width - 1);
  });

  test('renders in the light theme and at phone width', async ({ page }) => {
    await abrir(page, { tema: 'light' });
    await expect(page.locator('#tanques-plano .tanque')).toHaveCount(72);
    await expect(page.locator('#tanques-panel h2')).toBeVisible();

    await page.setViewportSize({ width: 400, height: 900 });
    await page.waitForTimeout(200);
    // The plan scrolls horizontally inside its card instead of shrinking the
    // tanks away, and the panel stacks under it.
    const caja = await page.locator('.tanques-plan-scroll').evaluate((el) => ({
      cliente: el.clientWidth, contenido: el.scrollWidth,
    }));
    expect(caja.contenido).toBeGreaterThan(caja.cliente);
    const plan = await page.locator('.tanques-plan-card').boundingBox();
    const panel = await page.locator('.tanques-panel').boundingBox();
    expect(panel.y).toBeGreaterThan(plan.y);
    expect(plan.width).toBeLessThanOrEqual(400);

    // Nothing overflows the viewport horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // Touch floor on the only controls outside the SVG.
    const chicos = await page.$$eval('#tanques-modos button, #tanques-buscar', (els) =>
      els.map((e) => e.getBoundingClientRect())
        .filter((r) => r.height < 44)
        .length);
    expect(chicos).toBe(0);
  });
});

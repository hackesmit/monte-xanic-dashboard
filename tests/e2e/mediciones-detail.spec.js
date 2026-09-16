// tests/e2e/mediciones-detail.spec.js
// The Mediciones physicochemical panel, in a real browser.
//
// The MT.45 suite pins the model; this pins that the panel actually opens,
// renders at 320px without a horizontal scrollbar, and that a white row reads
// NA where a red row reads a number. Screenshots land in test-results/ for a
// human to look at.

import { test, expect } from '@playwright/test';

const RED = {
  code: 'MT-E2E-RED', date: '2026-09-10', vintage: 2026,
  variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
  lotCode: 'KCS-S1', tons: 8.5,
  brix: 24.0, pH: 3.6, ta: 6.0, av: 0.01, ag: 0, am: 2.4,
  berryWeight: 1.0, catechins: null, polyphenols: 1950, anthocyanins: 1100,
  berryCount: 200, berryDiameter: 13.1,
  healthGrade: 'Muy limpio',
  healthMadura: 190, healthInmadura: 4, healthSobremadura: 3,
  healthPicadura: 2, healthEnfermedad: 1, healthQuemadura: 0,
  phenolicMaturity: 'Sobresaliente', evaluaciones: [],
  measuredBy: 'E2E', notes: null, source: 'upload',
};

const WHITE = {
  ...RED,
  code: 'MT-E2E-BLANCO', variety: 'Sauvignon Blanc',
  appellation: 'Valle de Guadalupe', lotCode: 'SBVDG-1C',
  brix: 21.0, pH: 3.15, ta: 6.8, berryWeight: 1.2,
  // The workbook prints NA for both on whites.
  polyphenols: null, anthocyanins: null,
};

// The app's modules are not on window, so the rows are injected through the
// same localStorage cache the loader reads at boot.
async function seed(context, rows) {
  await context.addInitScript(([rows]) => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
      localStorage.setItem('xanic_e2e_mediciones', JSON.stringify(rows));
    } catch (_) { /* ignore */ }
  }, [rows]);
}

async function openMediciones(page, rows) {
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.locator('.nav-tab[data-view="mediciones"]').click();
  // Push the rows straight into the table the way a refresh would, using the
  // module graph the page already loaded.
  await page.evaluate(async (rows) => {
    const { DataStore } = await import('/js/dataLoader.js');
    const { Mediciones } = await import('/js/mediciones.js');
    DataStore.medicionesData = rows;
    DataStore.berryData = DataStore.berryData || [];
    Mediciones.refresh();
  }, rows);
  await page.waitForSelector('#med-table-body tr', { timeout: 5_000 });
}


// Element screenshots race the scroll that precedes them, so the capture is
// framed from the panel's own box after the layout has settled.
async function shootPanel(page, panel, path) {
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await panel.boundingBox();
  if (!box) return;
  await page.screenshot({ path, clip: box });
}

test.describe('Mediciones physicochemical panel', () => {
  test('a red row opens and shows every axis with its bucket', async ({ page, context }) => {
    await seed(context, [RED]);
    await openMediciones(page, [RED]);

    const btn = page.locator(`.med-expand-btn[data-med-expand="${RED.code}"]`);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');

    const panel = page.locator('.med-detail-panel');
    await expect(panel).toBeVisible();
    for (const criterio of ['Fisicoquimico', 'Sanidad', 'Rendimiento', 'Fenolico']) {
      await expect(panel.locator('.med-detail-criterio', { hasText: criterio })).toHaveCount(1);
    }
    await expect(panel).toContainText('Grado Brix');
    await expect(panel).toContainText('24.0 Bx');
    await expect(panel).toContainText('Antocianos totales');
    await expect(panel).toContainText('1100 ppm');
    // A red must NOT read NA on the phenolic axes.
    await expect(panel.locator('.med-axis-na-mark')).toHaveCount(0);
    // .table-scroll caps the table at 400px and scrolls inside itself, so the
    // last group is the one at risk of opening below that box's fold.
    const phenolic = panel.locator('.med-detail-group', { hasText: 'Fenolico' });
    // Reachable, not merely present: .table-scroll caps the table at 400px and
    // scrolls inside itself, so the last group is the one at risk of being
    // clipped away rather than just sitting below the current scroll position.
    await phenolic.scrollIntoViewIfNeeded();
    await expect(phenolic).toBeInViewport();
    await expect(phenolic).toContainText('1100 ppm');

    await shootPanel(page, panel, 'test-results/mediciones-detail-red.png');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('a white row reads NA on polifenoles and antocianos', async ({ page, context }) => {
    await seed(context, [WHITE]);
    await openMediciones(page, [WHITE]);

    await page.locator(`.med-expand-btn[data-med-expand="${WHITE.code}"]`).click();
    const panel = page.locator('.med-detail-panel');
    await expect(panel).toBeVisible();

    const naAxes = panel.locator(".med-axis-na-mark");
    await expect(naAxes).toHaveCount(2);
    const phenolic = panel.locator('.med-detail-group', { hasText: 'Fenolico' });
    // Reachable, not merely present: .table-scroll caps the table at 400px and
    // scrolls inside itself, so the last group is the one at risk of being
    // clipped away rather than just sitting below the current scroll position.
    await phenolic.scrollIntoViewIfNeeded();
    await expect(phenolic).toBeInViewport();
    await expect(phenolic).toContainText('Polifenoles');
    await expect(phenolic).toContainText('NA');
    await expect(phenolic).toContainText('Antocianos totales');
    // NA is not a gap: "sin dato" must not appear on those axes.
    await expect(phenolic.locator(".med-axis-gap")).toHaveCount(0);

    await shootPanel(page, panel, 'test-results/mediciones-detail-white.png');
  });

  test('the panel fits 320px with no horizontal page scroll', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await seed(context, [RED, WHITE]);
    await openMediciones(page, [RED, WHITE]);

    await page.locator(`.med-expand-btn[data-med-expand="${WHITE.code}"]`).click();
    await expect(page.locator('.med-detail-panel')).toBeVisible();
    await shootPanel(page, page.locator('.med-detail-panel'), 'test-results/mediciones-detail-320.png');

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 320px').toBeLessThanOrEqual(0);

    // The detail cell spans the whole table, which is several times wider than
    // a phone. Every axis has to sit inside the scroll window, or the labels
    // are visible on a phone and the values and buckets are not.
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('.med-detail-panel');
      const scroller = panel.closest('.table-scroll');
      const sb = scroller.getBoundingClientRect();
      const axes = [...panel.querySelectorAll('.med-axis')];
      const worst = Math.max(...axes.map(a => a.getBoundingClientRect().right - sb.right));
      return { worst: Math.round(worst), axes: axes.length,
               panelW: Math.round(panel.getBoundingClientRect().width),
               windowW: Math.round(sb.width) };
    });
    expect(fit.axes, 'the panel rendered its axes').toBeGreaterThan(8);
    expect(fit.panelW, 'panel is sized to the scroll window, not the table')
      .toBeLessThanOrEqual(fit.windowW + 1);
    expect(fit.worst, 'every axis fits inside the scroll window').toBeLessThanOrEqual(1);
  });

  test('opening the panel does not also open the edit modal', async ({ page, context }) => {
    // The expand button sits inside a .row-clickable row for write-capable
    // users, so the delegation has to claim the click first.
    await seed(context, [RED]);
    await openMediciones(page, [RED]);
    await page.locator(`.med-expand-btn[data-med-expand="${RED.code}"]`).click();
    await expect(page.locator('.med-detail-panel')).toBeVisible();
    const modal = page.locator('#med-edit-modal');
    if (await modal.count()) await expect(modal).not.toHaveAttribute('open', '');
  });
});

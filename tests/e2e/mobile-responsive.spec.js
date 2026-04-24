// Mobile responsiveness regression guard. Locks in the fixes from R21/R22
// (C3–C7, C15, C17) against accidental regressions.
//
// Prerequisites (run once):
//   npx playwright install chromium
//
// Run:
//   npm run test:e2e
//
// Notes:
// - Under `vite dev` the Vercel serverless endpoints (/api/verify, /api/config)
//   are unreachable. Auth.init() catches the JSON parse error and falls through
//   to the localhost bypass path (js/auth.js:40-48), provided a token exists in
//   localStorage. We set that token via addInitScript before navigation.
// - With no /api/config the dashboard renders empty data — that's fine for
//   layout/touch-target assertions. Anything data-dependent (long row labels,
//   wrapped chart legends, SVG map section detail) is out of scope.

import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 }, // iPhone SE
  { name: '390x844', width: 390, height: 844 }, // iPhone 14
];

const VIEWS = ['berry', 'wine', 'extraction', 'vintage', 'map', 'explorer', 'mediciones'];

async function installBypassToken(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'admin');
    } catch (_) { /* ignore */ }
  });
}

async function gotoDashboard(page) {
  await page.goto('/');
  // Login screen may flash first; wait until dashboard-content is visible.
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  // Give Vite + CSS a beat to settle.
  await page.waitForTimeout(200);
}

async function switchView(page, view) {
  const tab = page.locator(`.nav-tab[data-view="${view}"]`);
  if (await tab.count() === 0) return false;
  await tab.click();
  await page.waitForTimeout(200);
  return true;
}

// Collect visible violations of a sub-44×44 rule for a given selector.
async function measureTapTargets(page, selector, min = 44) {
  return page.$$eval(
    selector,
    (els, min) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          const visible = !!el.offsetParent && r.width > 0 && r.height > 0;
          return {
            visible,
            w: Math.round(r.width),
            h: Math.round(r.height),
            text: (el.textContent || '').trim().slice(0, 40),
          };
        })
        .filter((m) => m.visible && (m.w < min || m.h < min)),
    min
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`Mobile @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('login theme toggle is inside viewport and ≥ 44×44', async ({ page, context }) => {
      // Fresh context, no token — land on login screen.
      await page.goto('/');
      await page.waitForSelector('#login-theme-toggle', { state: 'visible' });
      // Login card has a 0.6 s fade-in animation that uses `transform`, which
      // establishes a containing block for fixed descendants while running.
      // Wait for the card's animations specifically (a loader spinner elsewhere
      // on the page runs infinitely, so document.getAnimations() never settles).
      await page.waitForFunction(() => {
        const card = document.querySelector('.login-card');
        if (!card) return false;
        const anims = card.getAnimations({ subtree: true });
        return anims.length > 0 && anims.every((a) => a.playState === 'finished');
      });
      const box = await page.locator('#login-theme-toggle').boundingBox();
      expect(box, 'login-theme-toggle has a bounding box').not.toBeNull();
      expect(box.x, 'not clipped left').toBeGreaterThanOrEqual(0);
      expect(box.y, 'not clipped above viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'not clipped right').toBeLessThanOrEqual(vp.width);
      expect(box.width, 'width ≥ 44').toBeGreaterThanOrEqual(44);
      expect(box.height, 'height ≥ 44').toBeGreaterThanOrEqual(44);
    });

    test('no horizontal page overflow on any nav view', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);

      for (const view of VIEWS) {
        const ok = await switchView(page, view);
        if (!ok) continue;
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          scrollWidth,
          `${view} at ${vp.name}: scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`
        ).toBeLessThanOrEqual(innerWidth);
      }
    });

    test('nav tabs are ≥ 44×44', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);
      const violations = await measureTapTargets(page, '.nav-tab', 44);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });

    test('map ranch tabs are ≥ 44×44', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);
      const ok = await switchView(page, 'map');
      if (!ok) test.skip();
      const violations = await measureTapTargets(page, '.ranch-tab', 44);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });

    test('mediciones form inputs + primary button are ≥ 44 px tall', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);
      const ok = await switchView(page, 'mediciones');
      if (!ok) test.skip();
      const inputs = await measureTapTargets(page, '.form-group input, .form-group select', 44);
      const buttons = await measureTapTargets(page, '.btn-gold', 44);
      expect(inputs, `form controls under 44px:\n${JSON.stringify(inputs, null, 2)}`).toEqual([]);
      expect(buttons, `btn-gold under 44px:\n${JSON.stringify(buttons, null, 2)}`).toEqual([]);
    });

    test('map metric select is ≥ 44 px tall', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);
      const ok = await switchView(page, 'map');
      if (!ok) test.skip();
      const violations = await measureTapTargets(page, '#map-metric-select', 44);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });

    test('weather forecast controls are ≥ 44 px tall (R24)', async ({ page, context }) => {
      await installBypassToken(context);
      await gotoDashboard(page);
      const ok = await switchView(page, 'vintage');
      if (!ok) test.skip();
      // The horizon <select> is display:none until the toggle is clicked.
      // Clicking the toggle fires an Open-Meteo request; reveal the select
      // directly so the test does not depend on the network.
      await page.evaluate(() => {
        const sel = document.getElementById('weather-forecast-horizon');
        if (sel) sel.style.display = 'inline-block';
      });
      const violations = await measureTapTargets(
        page,
        '#weather-forecast-toggle, #weather-forecast-horizon',
        44
      );
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  });
}

// Dark-mode regression guard.
//
// The Predicción view was authored with hardcoded light hex values, and its
// `.chip` rule was written unscoped. Because that block sits after the themed
// filter-chip rules, a bare `.chip` overrode them globally and the sidebar's
// Varietal/Origen chips rendered as white pills with light-theme text in dark
// mode. These tests assert the opposite: with data-theme="dark", nothing in
// these surfaces paints a light background.
//
// See the harness notes in mobile-responsive.spec.js for why the localhost
// auth bypass is needed under `vite dev`.

import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 900 } });

// Relative luminance; ~0.5+ is a light surface.
function luminance(rgb) {
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (alpha === 0) return null; // fully transparent paints nothing
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// WCAG relative luminance + contrast ratio.
function relLum(rgb) {
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = relLum(fg);
  const b = relLum(bg);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function bootTheme(page, context, theme, view) {
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'admin');
      localStorage.setItem('xanic_theme', t);
    } catch (_) { /* ignore */ }
  }, theme);
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.click('#demo-toggle-btn');
  await page.waitForTimeout(1800);
  if (view) {
    await page.click(`.nav-tab[data-view="${view}"]`);
    await page.waitForTimeout(1200);
  }
}

async function bootDark(page, context, view) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'admin');
      localStorage.setItem('xanic_theme', 'dark');
    } catch (_) { /* ignore */ }
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  // Demo mode supplies rows so the chips and predictor cards actually render.
  await page.click('#demo-toggle-btn');
  await page.waitForTimeout(1800);
  if (view) {
    await page.click(`.nav-tab[data-view="${view}"]`);
    await page.waitForTimeout(1200);
  }
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
}

test('sidebar filter chips are not light-filled in dark mode', async ({ page, context }) => {
  await bootDark(page, context, null);
  const chips = await page.$$eval('#variety-chips .chip, #origin-chips .chip', (els) =>
    els.slice(0, 12).map((el) => ({
      text: (el.textContent || '').trim().slice(0, 24),
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
    }))
  );
  expect(chips.length, 'demo mode rendered filter chips').toBeGreaterThan(0);
  const light = chips.filter((c) => {
    const l = luminance(c.bg);
    return l !== null && l > 0.5;
  });
  expect(light, `chips with a light background in dark mode:\n${JSON.stringify(light, null, 2)}`).toEqual([]);
});

test('Predicción surfaces follow the dark theme', async ({ page, context }) => {
  await bootDark(page, context, 'prediccion');
  const surfaces = await page.$$eval(
    '.pred-card, .chip-bar .chip, .settings-table th, .pred-card-empty',
    (els) =>
      els.slice(0, 20).map((el) => ({
        cls: String(el.className).slice(0, 40),
        bg: getComputedStyle(el).backgroundColor,
      }))
  );
  expect(surfaces.length, 'predictor cards rendered').toBeGreaterThan(0);
  const light = surfaces.filter((s) => {
    const l = luminance(s.bg);
    // The active chip is an intentional gold fill; everything else must be dark.
    return l !== null && l > 0.5 && !s.cls.includes('chip-active');
  });
  expect(light, `light surfaces in dark mode:\n${JSON.stringify(light, null, 2)}`).toEqual([]);
});

test('predictor card text stays readable against its card', async ({ page, context }) => {
  await bootDark(page, context, 'prediccion');
  // The original bug put cream text (var(--text)) on a hardcoded #fff card.
  const pair = await page.evaluate(() => {
    const card = document.querySelector('.pred-card');
    if (!card) return null;
    const title = card.querySelector('.pred-card-title, h3, strong') || card;
    return {
      cardBg: getComputedStyle(card).backgroundColor,
      textColor: getComputedStyle(title).color,
    };
  });
  expect(pair, 'a predictor card is present').not.toBeNull();
  const bgL = luminance(pair.cardBg);
  const fgL = luminance(pair.textColor);
  expect(bgL, `card background ${pair.cardBg} should be dark`).toBeLessThan(0.5);
  expect(
    Math.abs(fgL - bgL),
    `text ${pair.textColor} on card ${pair.cardBg} has too little contrast`
  ).toBeGreaterThan(0.2);
});

// --gold is mid-dark on BOTH themes, so anything filled with it needs a
// foreground that does not invert. Using --black gave white-on-gold in light
// mode at about 3.9:1, under the 4.5:1 floor. Caught by cross-vendor review.
for (const theme of ['light', 'dark']) {
  test(`gold-filled controls keep readable contrast in ${theme}`, async ({ page, context }) => {
    await bootTheme(page, context, theme, 'prediccion');
    const samples = await page.$$eval('.chip-bar .chip.chip-active, .btn-gold', (els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => ({
          sel: String(el.className).slice(0, 40),
          fg: getComputedStyle(el).color,
          bg: getComputedStyle(el).backgroundColor,
        }))
    );
    expect(samples.length, 'a gold-filled control is rendered').toBeGreaterThan(0);
    const poor = samples
      .map((s) => ({ ...s, ratio: contrast(s.fg, s.bg) }))
      .filter((s) => s.ratio !== null && s.ratio < 4.5);
    expect(
      poor,
      `gold-filled controls under 4.5:1 in ${theme}:\n${JSON.stringify(poor, null, 2)}`
    ).toEqual([]);
  });
}

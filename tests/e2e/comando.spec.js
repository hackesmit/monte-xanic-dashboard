// tests/e2e/comando.spec.js
// hq-ik6v0.7: the Ctrl-K command menu, keyboard only.

import { test, expect } from '@playwright/test';

test('Control+k opens the menu, a typed filter plus Enter changes the view, Escape restores focus', async ({ page, context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
    } catch (_) { /* ignore */ }
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.waitForSelector('#loading-spinner', { state: 'hidden', timeout: 12_000 });
  await page.waitForLoadState('networkidle');

  const trigger = page.locator('#comando-btn');
  await expect(trigger).toHaveAttribute('aria-keyshortcuts', /Control\+K/);
  await expect(trigger.locator('kbd')).toBeVisible();

  await page.locator('.nav-tab[data-view="berry"]').focus();
  await page.keyboard.press('Control+k');
  const menu = page.locator('#comando');
  await expect(menu).toBeVisible();
  await expect(page.locator('#comando-lista li').first()).toBeVisible();
  await expect(page.locator('.comando-input')).toBeFocused();

  await page.keyboard.type('mediciones');
  await expect(page.locator('#comando-lista li')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/comando-open.png' });
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.locator('.nav-tab[data-view="mediciones"]')).toHaveClass(/active/);

  // Escape closes and returns focus to where it was.
  await page.locator('.nav-tab[data-view="tanques"]').focus();
  await page.keyboard.press('Control+k');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('.nav-tab[data-view="tanques"]')).toBeFocused();
});

async function boot(page, context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', 'lab');
    } catch (_) { /* ignore */ }
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  await page.waitForSelector('#loading-spinner', { state: 'hidden', timeout: 12_000 });
  await page.waitForLoadState('networkidle');
}

test('Control+k inside the lot search box is left to the field', async ({ page, context }) => {
  await boot(page, context);
  await page.locator('#lot-search').focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#comando')).toBeHidden();
  await expect(page.locator('#lot-search')).toBeFocused();
  // From a tab it still opens.
  await page.locator('.nav-tab[data-view="berry"]').focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#comando')).toBeVisible();
});

test('running Ayuda leaves focus in the help modal, not on the opener', async ({ page, context }) => {
  await boot(page, context);
  await page.locator('.nav-tab[data-view="berry"]').focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('ayuda');
  await page.keyboard.press('Enter');
  await expect(page.locator('#help-modal')).toBeVisible();
  await page.waitForTimeout(200);
  const focusOnTab = await page.evaluate(() => !!document.activeElement.closest('#nav-tabs'));
  expect(focusOnTab).toBe(false);
});

test('actions whose button is not rendered are not offered; aria-expanded follows the list', async ({ page, context }) => {
  await boot(page, context);
  await page.evaluate(() => { document.getElementById('demo-toggle-btn').style.display = 'none'; });
  await page.keyboard.press('Control+k');
  await expect(page.locator('#comando-lista li', { hasText: 'Modo Demo' })).toHaveCount(0);
  await expect(page.locator('#comando-lista li', { hasText: 'Ayuda' })).toHaveCount(1);
  const input = page.locator('.comando-input');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.type('zzzzzz');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('a control hidden with visibility:hidden is not offered', async ({ page, context }) => {
  await boot(page, context);
  await page.evaluate(() => { document.getElementById('demo-toggle-btn').style.visibility = 'hidden'; });
  await page.keyboard.press('Control+k');
  await expect(page.locator('#comando-lista li', { hasText: 'Modo Demo' })).toHaveCount(0);
});

test('the loading status is not marked busy, so screen readers announce it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading-spinner')).not.toHaveAttribute('aria-busy', /.*/);
});

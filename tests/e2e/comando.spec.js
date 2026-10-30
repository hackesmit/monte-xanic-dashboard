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

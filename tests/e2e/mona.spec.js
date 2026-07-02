// Mona chat smoke test. Runs under `vite dev`, where the Vercel /api endpoints
// are unreachable — so we intercept /api/mona (SSE) and /api/mona-data (JSON)
// with Playwright routes and assert the full loop: stream → chart → pin → Guardados.
import { test, expect } from '@playwright/test';

const CHART_SPEC = {
  type: 'bar', title: 'Brix por variedad', xLabel: 'Variedad', yLabel: '°Bx',
  series: [{ label: 'Brix', points: [{ x: 'Cabernet Sauvignon', y: 24 }, { x: 'Durif', y: 22 }] }],
};

// Build an Anthropic-style SSE body from an array of `data:` payloads.
function sse(payloads) {
  return payloads.map(p => `event: ${p.type}\ndata: ${JSON.stringify(p)}\n\n`).join('');
}

const FIRST_TURN = sse([
  { type: 'message_start' },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Aquí tienes la gráfica:' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'render_chart', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(CHART_SPEC) } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
]);

const SECOND_TURN = sse([
  { type: 'message_start' },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Listo.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
]);

async function setup(page) {
  await page.addInitScript(() => {
    localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
    localStorage.setItem('xanic_user_role', 'admin');
  });

  const saved = [];
  let monaCalls = 0;

  await page.route('**/api/mona-data', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    let json = { ok: true };
    switch (body.action) {
      case 'listConversations': json = []; break;
      case 'createConversation': json = { id: 'conv-1', title: 'Conversación' }; break;
      case 'getMessages': json = []; break;
      case 'listKnowledge': json = []; break;
      case 'listSavedViews': json = saved.slice(); break;
      case 'saveView': {
        const v = { id: `v${saved.length + 1}`, title: body.title, view_type: body.view_type, spec: body.spec };
        saved.push(v); json = v; break;
      }
      default: json = { ok: true };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });

  await page.route('**/api/mona', async (route) => {
    monaCalls += 1;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: monaCalls === 1 ? FIRST_TURN : SECOND_TURN });
  });

  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
}

test('Mona streams a reply, renders a chart, and pins it to Guardados', async ({ page }) => {
  await setup(page);

  // Open Mona tab
  await page.locator('.nav-tab[data-view="mona"]').click();
  await expect(page.locator('#mona-input')).toBeVisible();

  // Send a message
  await page.locator('#mona-input').fill('Grafica el brix por variedad');
  await page.locator('[data-mona-send]').click();

  // Streamed assistant text appears
  await expect(page.locator('.mona-msg-bot').first()).toContainText('Aquí tienes la gráfica', { timeout: 8_000 });

  // Chart canvas rendered inline
  await expect(page.locator('.mona-display-card canvas').first()).toBeVisible({ timeout: 8_000 });

  // Follow-up turn text
  await expect(page.locator('#mona-thread')).toContainText('Listo.', { timeout: 8_000 });

  // Pin to Guardados (accept the title prompt)
  page.once('dialog', d => d.accept('Mi gráfica'));
  await page.locator('.mona-pin-btn').first().click();
  await expect(page.locator('.mona-pin-btn').first()).toContainText('Guardado', { timeout: 8_000 });

  // Guardados tab shows the saved chart
  await page.locator('.nav-tab[data-view="guardados"]').click();
  await expect(page.locator('.mona-saved-card')).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.mona-saved-title')).toContainText('Mi gráfica');
});

test('Floating widget opens and shares the conversation', async ({ page }) => {
  await setup(page);

  // Widget FAB visible on a normal view
  await expect(page.locator('.mona-fab')).toBeVisible();
  await page.locator('[data-mona-fab]').click();
  await expect(page.locator('#mona-widget')).toBeVisible();

  // Send from the widget
  await page.locator('#mona-widget-input').fill('Hola Mona');
  await page.locator('[data-mona-widget-send]').click();
  await expect(page.locator('#mona-widget-thread')).toContainText('Aquí tienes la gráfica', { timeout: 8_000 });
});

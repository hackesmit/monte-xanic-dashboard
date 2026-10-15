// The Tanques inbox: trasiegos proposed from wine_samples.vessel_id, confirmed
// or dismissed by a person. Bead xd-qrn.6.
//
// mt58-tanques-inferencia.test.mjs proves WHICH movements the samples name;
// this proves the surface works: the cards are drawn in date order, Confirmar
// opens the xd-qrn.5 dialog prefilled with the proposal and posts fuente 'lab',
// Descartar asks before it sends, and a dismissed proposal stays dismissed
// after a reload.
//
// NOTHING is written to production. /api/tanques is answered by the same kind
// of in-memory stand-in as tanques-movimientos.spec.js, validating with the
// REAL js/tanques/estado.js, and it keeps its own dismissal table.
//
// The samples are the two lotes the bead's DoD names, copied out of production
// wine_samples on 2026-10-15.
//
// Prerequisites: npx playwright install chromium
// Run: npm run test:e2e -- tanques-inbox

import { test, expect } from '@playwright/test';
import { catalogoTanques, sinonimosTanques } from '../fixtures/tanques-catalogo.mjs';
import { validarMovimientoEnLog } from '../../js/tanques/estado.js';

const TANQUES = catalogoTanques();
const SINONIMOS = sinonimosTanques();

let seq = 0;
const mv = (o) => ({
  id: 1000 + (seq += 1),
  fecha: '2025-10-29',
  tipo: 'recepcion',
  origen: null,
  destino: null,
  lot_code: 'sin lote',
  vintage_year: 2025,
  volumen_l: 0,
  merma_l: 0,
  nota: null,
  fuente: 'manual',
  creado_por: 'daniel',
  created_at: `2025-10-29T00:00:${String(seq).padStart(2, '0')}Z`,
  anulado: false,
  client_id: null,
  ...o,
});

// D5 holds 10 300 L and 25CSKMP-4 was received into it before the first
// proposed trasiego, so Confirmar has wine to move. 25DUKMP-3 is deliberately
// NOT received: its first proposal must say the origin is empty rather than
// pretend it can be recorded.
const SEMILLA = () => [
  mv({ fecha: '2025-10-30', destino: 'D5', lot_code: '25CSKMP-4', volumen_l: 8000 }),
];

const muestra = (codigoBodega, fecha, tanque, extra = {}) =>
  ({ codigoBodega, fecha, tanque, vintage: 2025, sampleType: 'Must', ...extra });

const rango = (lote, mes, a, b, tanque, extra) => {
  const out = [];
  for (let d = a; d <= b; d++) out.push(muestra(lote, `${mes}-${String(d).padStart(2, '0')}`, tanque, extra));
  return out;
};

// 25CSKMP-4: D5 to 11-11, E1 from 11-12, H8 from 12-01.
// 25DUKMP-3: D5, D1, E5, B4.
// 24CFVA-1 : F9 throughout, with barrel (BCA) samples in between - a vessel the
//            catalog does not have, so it is reported and never proposed.
const MUESTRAS = [
  ...rango('25CSKMP-4', '2025-10', 30, 31, 'D5'),
  ...rango('25CSKMP-4', '2025-11', 1, 11, 'D5'),
  ...rango('25CSKMP-4', '2025-11', 12, 21, 'E1', { sampleType: 'Young Wine' }),
  muestra('25CSKMP-4', '2025-12-01', 'H8', { sampleType: 'Young Wine' }),
  ...rango('25DUKMP-3', '2025-10', 12, 17, 'D5'),
  ...rango('25DUKMP-3', '2025-10', 18, 20, 'D1'),
  ...rango('25DUKMP-3', '2025-10', 21, 22, 'E5'),
  ...rango('25DUKMP-3', '2025-10', 23, 25, 'B4'),
  muestra('24CFVA-1', '2025-06-04', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
  muestra('24CFVA-1', '2025-06-20', 'BCA', { vintage: 2024, sampleType: 'Aging Wine' }),
  muestra('24CFVA-1', '2025-07-10', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
];

// The three shapes the inference refuses to turn into a movement. They have to
// be in a fixture of their own: the inbox builds a diagnostic line for each,
// and a plain fixture never reaches that code at all (lucy, 2026-10-15).
const AMBIGUAS = [
  // in two tanks for weeks: a split, a blend, or a mistyped tank
  ...rango('25SYVA-9', '2025-09', 1, 20, 'E6'),
  ...rango('25SYVA-9', '2025-09', 2, 20, 'F3'),
  // in two tanks on one single day, with nothing saying which came first
  muestra('25TEON-9', '2025-10-05', 'A2'),
  muestra('25TEON-9', '2025-10-05', 'A4'),
  // and a stretch whose only reading is a vessel the catalog does not have
  muestra('25MEVA-9', '2025-10-01', 'D5'),
  muestra('25MEVA-9', '2025-10-02', 'C9'),
  muestra('25MEVA-9', '2025-10-03', 'E1'),
];

// --- the stand-in API --------------------------------------------------------

function servidor() {
  const s = {
    movimientos: SEMILLA(),
    descartadas: [],
    cuerpos: [],
    proximoId: 2000,
    romperDescarte: false,
    retener: false,     // hold the next dismissal's response
    soltar: null,       // resolves it
  };

  s.crear = (mov) => {
    const previo = s.movimientos.find((m) => m.client_id && mov.client_id
      && m.client_id.toLowerCase() === String(mov.client_id).toLowerCase());
    if (previo) return { status: 200, body: { ok: true, duplicado: true, movimiento: previo } };
    const fila = {
      fecha: mov.fecha, tipo: mov.tipo, origen: mov.origen ?? null, destino: mov.destino ?? null,
      lot_code: mov.lot_code, vintage_year: mov.vintage_year, volumen_l: mov.volumen_l,
      merma_l: mov.merma_l ?? 0, nota: mov.nota ?? null, fuente: mov.fuente ?? 'manual',
      creado_por: 'daniel', client_id: mov.client_id, anulado: false,
      id: (s.proximoId += 1), created_at: new Date().toISOString(),
    };
    const errores = validarMovimientoEnLog(TANQUES, s.movimientos, fila, { sinonimos: SINONIMOS });
    if (errores.length) return { status: 400, body: { ok: false, error: errores[0], errores } };
    s.movimientos.push(fila);
    return { status: 200, body: { ok: true, movimiento: fila } };
  };

  // Idempotent on the clave, like public.tanques_propuestas_descartadas's
  // primary key plus Prefer: resolution=ignore-duplicates.
  s.descartar = (clave) => {
    if (s.romperDescarte) {
      return { status: 502, body: { ok: false, error: 'Error de base de datos en la bitácora de tanques' } };
    }
    if (!clave || String(clave).split('|').length !== 4) {
      return { status: 400, body: { ok: false, error: 'La clave de la propuesta no es válida.' } };
    }
    if (!s.descartadas.includes(clave)) s.descartadas.push(clave);
    return { status: 200, body: { ok: true, clave } };
  };

  return s;
}

async function montar(page, s, { rol = 'lab', muestras = MUESTRAS, ancho = 1440, alto = 1400 } = {}) {
  await page.setViewportSize({ width: ancho, height: alto });
  await page.addInitScript((r) => {
    try {
      localStorage.setItem('xanic_session_token', 'e2e.dev.bypass');
      localStorage.setItem('xanic_user_role', r);
      localStorage.setItem('xanic_theme', 'dark');
    } catch (_) { /* ignore */ }
  }, rol);

  await page.route('**/api/tanques', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, tanques: TANQUES, sinonimos: SINONIMOS,
          movimientos: s.movimientos, descartadas: s.descartadas,
        }),
      });
    }
    const cuerpo = JSON.parse(req.postData() || '{}');
    s.cuerpos.push(cuerpo);
    if (s.retener && cuerpo.action === 'descartar') {
      s.retener = false;
      await new Promise((resolve) => { s.soltar = resolve; });
    }
    const r = cuerpo.action === 'descartar'
      ? s.descartar(cuerpo.clave)
      : s.crear(cuerpo.movimiento || {});
    return route.fulfill({ status: r.status, contentType: 'application/json',
      body: JSON.stringify(r.body) });
  });

  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  // The wine samples come from Supabase, which `vite dev` cannot reach, so the
  // inbox's source is seeded straight onto the singleton the app imported.
  await page.evaluate(async (filas) => {
    const { DataStore } = await import('/js/dataLoader.js');
    DataStore.wineRecepcion = filas;
  }, muestras);
  await page.locator('.nav-tab[data-view="tanques"]').click();
  await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
  // The samples were seeded after the first render, so ask for one more.
  await page.evaluate(async () => {
    const { TanquesView } = await import('/js/tanques/view.js');
    TanquesView.render();
  });
  await page.waitForTimeout(150);
}

const inbox = (page) => page.locator('#tanques-inbox');
const tarjetas = (page) => page.locator('#tanques-inbox .tanques-prop');
const dialogo = (page) => page.locator('#tanques-dialogo');
const toast = (page) => page.locator('#tanques-toast');

// The card for one proposal, found by the lote and the route it states.
const tarjeta = (page, lote, ruta) => page.locator('#tanques-inbox .tanques-prop')
  .filter({ has: page.locator('.tanques-prop-cab b', { hasText: lote }) })
  .filter({ has: page.locator('.tanques-prop-ruta', { hasText: ruta }) });

// --- the inbox ---------------------------------------------------------------

test.describe('bandeja de propuestas del laboratorio', () => {
  test('propone la ruta de los dos lotes, en orden de fecha', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await expect(inbox(page)).toBeVisible();

    const rutas = await page.locator('#tanques-inbox .tanques-prop').evaluateAll(
      (els) => els.map((el) => [
        el.querySelector('.tanques-prop-cab b').textContent.trim(),
        el.querySelector('.tanques-prop-ruta').textContent.trim(),
      ].join(' ')));
    // 25DUKMP-3's three trasiegos are all in October, so they come first; then
    // 25CSKMP-4's two in November and December.
    expect(rutas).toEqual([
      '25DUKMP-3 D5 a D1',
      '25DUKMP-3 D1 a E5',
      '25DUKMP-3 E5 a B4',
      '25CSKMP-4 D5 a E1',
      '25CSKMP-4 E1 a H8',
    ]);
  });

  test('cada tarjeta muestra la evidencia de las muestras', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    const t = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    await expect(t).toContainText('13 muestras en D5 hasta el 11 nov');
    await expect(t).toContainText('10 muestras en E1 desde el 12 nov');
    // D5 really holds 8 000 L of this lote on that date, out of the log.
    await expect(t).toContainText('D5 tenía 8,000 L el 12 nov');
  });

  test('un origen vacío se dice en la tarjeta, no al pulsar Confirmar', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    // 25DUKMP-3 was never received, so D5 held nothing on 2025-10-18.
    await expect(tarjeta(page, '25DUKMP-3', 'D5 a D1')).toContainText('está vacío');
  });

  test('las vasijas que el catálogo no tiene se reportan, nunca se adivinan', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await expect(inbox(page)).toContainText('que el catálogo no tiene');
    const detalle = inbox(page).locator('details').first();
    await detalle.locator('summary').click();
    await expect(detalle).toContainText('BCA');
    // and 24CFVA-1 (F9 the whole time) gets no proposal out of it
    await expect(inbox(page)).not.toContainText('24CFVA-1');
  });

  test('cabe en un teléfono: ningún control se sale ni se encima', async ({ page }) => {
    const s = servidor();
    await montar(page, s, { ancho: 390, alto: 844 });
    await inbox(page).scrollIntoViewIfNeeded();
    const ancho = await inbox(page).evaluate((el) => el.getBoundingClientRect().width);
    expect(ancho).toBeLessThanOrEqual(390);
    // Every button of every card inside the inbox, and tall enough to tap.
    const cajas = await page.locator('#tanques-inbox button').evaluateAll(
      (els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, alto: r.height };
      }));
    expect(cajas.length).toBeGreaterThan(0);
    for (const c of cajas) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.right).toBeLessThanOrEqual(390);
      expect(c.alto).toBeGreaterThanOrEqual(28);
    }
    await page.screenshot({ path: 'test-results/tanques-inbox-movil.png', fullPage: true });
  });

  test('la evidencia ambigua se explica y no propone nada', async ({ page }) => {
    const s = servidor();
    await montar(page, s, { muestras: [...MUESTRAS, ...AMBIGUAS] });
    // the inbox still renders: building a diagnostic line must not throw
    await expect(inbox(page)).toBeVisible();
    await expect(tarjetas(page)).toHaveCount(5);
    for (const lote of ['25SYVA-9', '25TEON-9', '25MEVA-9']) {
      await expect(page.locator('#tanques-inbox .tanques-prop-cab b', { hasText: lote }))
        .toHaveCount(0);
    }
    const detalle = inbox(page).locator('details', { hasText: 'no convierten en movimiento' });
    await detalle.locator('summary').click();
    await expect(detalle).toContainText('25SYVA-9');
    await expect(detalle).toContainText('a la vez');
    await expect(detalle).toContainText('25TEON-9');
    await expect(detalle).toContainText('el mismo día');
    await expect(detalle).toContainText('25MEVA-9');
    await expect(detalle).toContainText('que el catálogo no tiene');
  });

  test('un visor no ve ningún control de la bandeja', async ({ page }) => {
    const s = servidor();
    await montar(page, s, { rol: 'viewer' });
    await expect(inbox(page)).toHaveCount(0);
  });
});

// --- Confirmar ---------------------------------------------------------------

test.describe('Confirmar abre el diálogo de xd-qrn.5', () => {
  test('el diálogo llega con la propuesta puesta y registra fuente lab', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await tarjeta(page, '25CSKMP-4', 'D5 a E1').getByRole('button', { name: /^Confirmar/ }).click();

    await expect(dialogo(page)).toBeVisible();
    // The proposal's date, not today, and the two tanks it names.
    await expect(dialogo(page).locator('[name="fecha"]')).toHaveValue('2025-11-12');
    await expect(dialogo(page)).toContainText('D5');
    await expect(dialogo(page)).toContainText('E1');
    await expect(dialogo(page)).toContainText('Propuesta del laboratorio');
    // The volume is what D5 held that day, capped by what E1 has free (8 200).
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('8000');
    await expect(dialogo(page).locator('[name="vintage_year"]')).toHaveValue('2025');

    await dialogo(page).getByRole('button', { name: 'Registrar' }).click();
    await expect(dialogo(page)).toBeHidden();

    const creados = s.cuerpos.filter((c) => c.action === 'crear');
    expect(creados).toHaveLength(1);
    const m = creados[0].movimiento;
    expect(m.fuente).toBe('lab');
    expect(m.origen).toBe('D5');
    expect(m.destino).toBe('E1');
    expect(m.lot_code).toBe('25CSKMP-4');
    expect(m.fecha).toBe('2025-11-12');
    expect(m.volumen_l).toBe(8000);
    // The idempotency key xd-qrn.5 mints: a confirmation is not a second write
    // path, so it carries one too.
    expect(m.client_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('la propuesta confirmada sale de la bandeja y la siguiente queda lista', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await tarjeta(page, '25CSKMP-4', 'D5 a E1').getByRole('button', { name: /^Confirmar/ }).click();
    await dialogo(page).getByRole('button', { name: 'Registrar' }).click();
    await expect(dialogo(page)).toBeHidden();

    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);
    // E1 now holds the lote, so the next leg of the route can be recorded.
    await expect(tarjeta(page, '25CSKMP-4', 'E1 a H8')).toContainText('E1 tenía 8,000 L');
  });

  test('la fecha corregida en el diálogo no devuelve la propuesta a la bandeja', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await tarjeta(page, '25CSKMP-4', 'D5 a E1').getByRole('button', { name: /^Confirmar/ }).click();
    // The real trasiego was the day before the first sample in E1.
    await dialogo(page).locator('[name="fecha"]').fill('2025-11-11');
    await dialogo(page).locator('[name="fecha"]').dispatchEvent('change');
    await expect(dialogo(page)).toContainText('8,000 L');
    await dialogo(page).getByRole('button', { name: 'Registrar' }).click();
    await expect(dialogo(page)).toBeHidden();

    const m = s.cuerpos.filter((c) => c.action === 'crear')[0].movimiento;
    expect(m.fecha).toBe('2025-11-11');
    expect(m.fuente).toBe('lab');
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);
  });
});

// --- Descartar ---------------------------------------------------------------

test.describe('Descartar', () => {
  test('pregunta antes de enviar, y "No" no envía nada', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    const t = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    await t.getByRole('button', { name: /^Descartar/ }).click();
    await expect(t).toContainText('¿Descartar esta propuesta?');
    expect(s.cuerpos).toHaveLength(0);
    await t.getByRole('button', { name: 'No' }).click();
    await expect(t.getByRole('button', { name: /^Descartar/ })).toBeVisible();
    expect(s.cuerpos).toHaveLength(0);
  });

  test('un descarte confirmado manda la clave y la propuesta desaparece', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    const t = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    await t.getByRole('button', { name: /^Descartar/ }).click();
    await t.getByRole('button', { name: 'Sí, descartar' }).click();

    await expect(toast(page)).toContainText('Propuesta descartada');
    expect(s.cuerpos).toEqual([{ action: 'descartar', clave: '25CSKMP-4|D5|E1|2025-11-12' }]);
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);
    // only that one
    await expect(tarjeta(page, '25CSKMP-4', 'E1 a H8')).toHaveCount(1);
    await expect(tarjetas(page)).toHaveCount(4);
  });

  test('un descarte sobrevive la recarga', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    const t = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    await t.getByRole('button', { name: /^Descartar/ }).click();
    await t.getByRole('button', { name: 'Sí, descartar' }).click();
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);

    await montar(page, s);
    await expect(inbox(page)).toBeVisible();
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);
    await expect(tarjetas(page)).toHaveCount(4);
    // and the server was not asked a second time
    expect(s.cuerpos.filter((c) => c.action === 'descartar')).toHaveLength(1);
  });

  test('mientras un descarte está en vuelo, los demás esperan en vez de parecer vivos', async ({ page }) => {
    const s = servidor();
    s.retener = true;
    await montar(page, s);
    const a = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    const b = tarjeta(page, '25DUKMP-3', 'D5 a D1');
    await a.getByRole('button', { name: /^Descartar/ }).click();
    await a.getByRole('button', { name: 'Sí, descartar' }).click();
    await expect(a.getByRole('button', { name: 'Descartando…' })).toBeDisabled();
    // every other card's controls wait too, so no click can be swallowed
    await expect(b.getByRole('button', { name: /^Descartar/ })).toBeDisabled();
    await expect(b.getByRole('button', { name: /^Confirmar/ })).toBeDisabled();
    expect(s.cuerpos.filter((c) => c.action === 'descartar')).toHaveLength(1);

    s.soltar();
    await expect(toast(page)).toContainText('Propuesta descartada');
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(0);
    // and the other proposal is live again, untouched
    await expect(b.getByRole('button', { name: /^Descartar/ })).toBeEnabled();
  });

  test('un descarte en vuelo no cierra la pregunta abierta en otra tarjeta', async ({ page }) => {
    const s = servidor();
    s.retener = true;
    await montar(page, s);
    const a = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    const b = tarjeta(page, '25DUKMP-3', 'D5 a D1');
    await a.getByRole('button', { name: /^Descartar/ }).click();
    await a.getByRole('button', { name: 'Sí, descartar' }).click();
    s.soltar();
    await expect(toast(page)).toContainText('Propuesta descartada');
    // B was never asked about, so it is back to its two buttons, not a stray
    // confirmation left open or closed by someone else's request
    await expect(b.getByRole('button', { name: /^Descartar/ })).toBeEnabled();
    await b.getByRole('button', { name: /^Descartar/ }).click();
    await expect(b).toContainText('¿Descartar esta propuesta?');
    await b.getByRole('button', { name: 'Sí, descartar' }).click();
    await expect(tarjeta(page, '25DUKMP-3', 'D5 a D1')).toHaveCount(0);
    expect(s.cuerpos.filter((c) => c.action === 'descartar').map((c) => c.clave))
      .toEqual(['25CSKMP-4|D5|E1|2025-11-12', '25DUKMP-3|D5|D1|2025-10-18']);
  });

  test('un descarte que el servidor rechaza deja la propuesta donde estaba', async ({ page }) => {
    const s = servidor();
    s.romperDescarte = true;
    await montar(page, s);
    const t = tarjeta(page, '25CSKMP-4', 'D5 a E1');
    await t.getByRole('button', { name: /^Descartar/ }).click();
    await t.getByRole('button', { name: 'Sí, descartar' }).click();
    await expect(toast(page)).toContainText('Error de base de datos');
    await expect(tarjeta(page, '25CSKMP-4', 'D5 a E1')).toHaveCount(1);
  });
});

// --- the screenshot the DoD asks for -----------------------------------------

test('la bandeja en vivo, para el acta del bead', async ({ page }) => {
  const s = servidor();
  await montar(page, s);
  await expect(inbox(page)).toBeVisible();
  await inbox(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/tanques-inbox.png', fullPage: true });
  await inbox(page).screenshot({ path: 'test-results/tanques-inbox-detalle.png' });
});

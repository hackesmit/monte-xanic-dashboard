// Recording a movement from the Tanques tab, end to end. Bead xd-qrn.5.
//
// mt57-tanques-moves.test.mjs proves what the dialog proposes and what gets
// posted; this proves the GESTURES reach it: drag a tank onto another tank,
// drag a lote from the tray, two taps in Modo mover, and the undo toast.
//
// NOTHING is written to production. movimientos_tanque is append-only, a test
// row can never be removed, and the real log is still empty, so Daniel's first
// movement must be the first row (coordinator note on the bead). /api/tanques
// is answered here by an in-memory stand-in that honours what the real one
// does: a version counter, client_id idempotency, and refusals. Its validation
// is the REAL js/tanques/estado.js, so a movement this mock refuses is one
// api/tanques.js would refuse too; the server's own gate is unit-tested in
// mt52-api-tanques.test.mjs.
//
// Prerequisites: npx playwright install chromium
// Run: npm run test:e2e -- tanques-movimientos

import { test, expect } from '@playwright/test';
import { catalogoTanques, sinonimosTanques } from '../fixtures/tanques-catalogo.mjs';
import { replayMovimientos, validarMovimientoEnLog } from '../../js/tanques/estado.js';

const TANQUES = catalogoTanques();
const SINONIMOS = sinonimosTanques();

let seq = 0;
function mv(o) {
  seq += 1;
  return {
    id: 1000 + seq,
    fecha: '2025-09-01',
    tipo: 'trasiego',
    origen: null,
    destino: null,
    lot_code: 'sin lote',
    vintage_year: 2025,
    volumen_l: 0,
    merma_l: 0,
    nota: null,
    fuente: 'manual',
    creado_por: 'daniel',
    created_at: `2025-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    anulado: false,
    client_id: null,
    ...o,
  };
}

// Capacities come from sql/migration_tanques.sql through the fixture: A5 15 000
// with 14 200 L in it, A1 7 400 with 6 900, C5 18 700 with 12 700, and B2 7 400
// and H1 18 700 empty.
const SEMILLA = () => [
  mv({ fecha: '2025-10-02', tipo: 'recepcion', destino: 'A5', lot_code: '25MEKMP-1', volumen_l: 14200 }),
  mv({ fecha: '2025-11-10', tipo: 'recepcion', destino: 'C5', lot_code: '25MEKMP-3', volumen_l: 12700 }),
  mv({ fecha: '2025-09-02', tipo: 'recepcion', destino: 'A1', lot_code: '25SBVDG-1', volumen_l: 6900 }),
];

// The wine samples the dashboard would have loaded. The tray lists the newest
// vendimia's lotes that no live movement places, so 25CSKMP-9 is the only one
// pending once the seed above has placed the other three.
const MUESTRAS = [
  { codigoBodega: '25MEKMP-1', vintage: 2025, fecha: '2025-10-02', sampleType: 'Must', variedad: 'Merlot' },
  { codigoBodega: '25MEKMP-3', vintage: 2025, fecha: '2025-11-10', sampleType: 'Must', variedad: 'Merlot' },
  { codigoBodega: '25SBVDG-1', vintage: 2025, fecha: '2025-09-02', sampleType: 'Must', variedad: 'Sauvignon Blanc' },
  { codigoBodega: '25CSKMP-9', vintage: 2025, fecha: '2025-10-20', sampleType: 'Must', variedad: 'Cabernet Sauvignon' },
  { codigoBodega: '24CSKMP-1', vintage: 2024, fecha: '2024-10-01', sampleType: 'Must', variedad: 'Cabernet Sauvignon' },
];

// --- the stand-in API --------------------------------------------------------

function servidor() {
  const s = {
    version: 1,
    movimientos: SEMILLA(),
    proximoId: 2000,
    cuerpos: [],          // every POST body, in order: the payload evidence
    gets: 0,
    guion: [],            // queued ['abortar'|'indeterminado'|'retener'] for the next POSTs
    soltar: null,         // resolves the held response
    romperGet: 0,         // GETs to fail before answering normally again
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
    s.version += 1;
    return { status: 200, body: { ok: true, movimiento: fila } };
  };

  s.anular = (id) => {
    const fila = s.movimientos.find((m) => String(m.id) === String(id));
    if (!fila) return { status: 404, body: { ok: false, error: 'El movimiento no existe.' } };
    if (fila.anulado) return { status: 200, body: { ok: true, ya_anulado: true, movimiento: fila } };
    const vivos = s.movimientos.filter((m) => !m.anulado);
    const clave = (a) => `${a.movimiento && a.movimiento.id}|${a.codigo}`;
    const antes = new Set(replayMovimientos(TANQUES, vivos, { sinonimos: SINONIMOS }).avisos.map(clave));
    const despues = replayMovimientos(TANQUES, vivos.filter((m) => m.id !== fila.id),
      { sinonimos: SINONIMOS }).avisos;
    const roto = despues.find((a) => (a.codigo === 'sobregiro' || a.codigo === 'desbordado')
      && !antes.has(clave(a)));
    if (roto) {
      return {
        status: 400,
        body: {
          ok: false,
          error: `No se puede anular: deja inconsistente un movimiento posterior: ${roto.mensaje}`,
        },
      };
    }
    fila.anulado = true;
    s.version += 1;
    return { status: 200, body: { ok: true, movimiento: fila } };
  };

  return s;
}

async function montar(page, s, { rol = 'lab', muestras = MUESTRAS, ancho = 1440, alto = 1000 } = {}) {
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
      s.gets += 1;
      if (s.romperGet > 0) {
        s.romperGet -= 1;
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'caida' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, version: s.version, tanques: TANQUES, sinonimos: SINONIMOS,
          movimientos: s.movimientos,
        }),
      });
    }
    const cuerpo = JSON.parse(req.postData() || '{}');
    s.cuerpos.push(cuerpo);
    const guion = s.guion.shift();
    if (guion === 'rechazar') {
      return route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Sin permisos para registrar movimientos' }) });
    }
    if (guion === 'retener') {
      await new Promise((resolve) => { s.soltar = resolve; });
    }
    if (guion === 'abortar') return route.abort('failed');
    if (guion === 'perdido') {
      // The INSERT commits and the answer is lost, and the re-read that would
      // reconcile it fails too: the one case where the client cannot tell.
      if (cuerpo.action === 'crear') s.crear(cuerpo.movimiento || {});
      s.romperGet += 1;
      return route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({
          ok: false, indeterminado: true,
          error: 'No se pudo confirmar si la escritura quedó en la bitácora de tanques. '
            + 'Revise la bitácora antes de repetirla.',
        }),
      });
    }
    if (guion === 'indeterminado') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false, indeterminado: true,
          error: 'No se pudo confirmar si la escritura quedó en la bitácora de tanques. '
            + 'Revise la bitácora antes de repetirla.',
        }),
      });
    }
    // The write lands and the re-read that follows it does not.
    if (guion === 'sin-relectura') s.romperGet += 1;
    const r = cuerpo.action === 'anular' ? s.anular(cuerpo.id) : s.crear(cuerpo.movimiento || {});
    return route.fulfill({
      status: r.status, contentType: 'application/json', body: JSON.stringify(r.body),
    });
  });

  await page.goto('/');
  await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
  // The wine samples come from Supabase, which `vite dev` cannot reach, so the
  // tray's source is seeded straight onto the singleton the app imported.
  await page.evaluate(async (filas) => {
    const { DataStore } = await import('/js/dataLoader.js');
    DataStore.wineRecepcion = filas;
  }, muestras);
  await page.locator('.nav-tab[data-view="tanques"]').click();
  await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
  await page.waitForTimeout(150);
}

const dialogo = (page) => page.locator('#tanques-dialogo');
const toast = (page) => page.locator('#tanques-toast');

async function arrastrar(page, desde, hasta) {
  // A pointer gesture only lands where the pointer can actually go, so both
  // ends have to be in the viewport before the first mouse event.
  await page.locator(hasta).scrollIntoViewIfNeeded();
  await page.locator(desde).scrollIntoViewIfNeeded();
  const a = await page.locator(desde).boundingBox();
  const b = await page.locator(hasta).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

// The tank group's own box is the lid plus the body, which is what the plan
// draws; aiming at the lid keeps the pointer inside the <g> that carries the
// data-tanque hook.
const tanque = (codigo) => `#tanques-plano [data-tanque="${codigo}"] .tanque-tapa`;

// --- tests -------------------------------------------------------------------

test.describe('Tanques: registrar movimientos', () => {
  test('a drag between two tanks records a trasiego and the toast undoes it', async ({ page }) => {
    const s = servidor();
    await montar(page, s);

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await expect(dialogo(page)).toBeVisible();
    await expect(dialogo(page).locator('h2')).toHaveText('Registrar trasiego');
    // B2 is 7 400 L and A5 has 14 200 L to send: the default is the clamp.
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('7400');
    await expect(dialogo(page).locator('.tanques-alert').filter({ hasText: 'excede el espacio libre' }))
      .toBeVisible();
    await expect(dialogo(page).locator('[name="vintage_year"]')).toHaveValue('2025');
    await dialogo(page).locator('[name="nota"]').fill('trasiego con aireación');
    await dialogo(page).locator('button[type="submit"]').click();

    await expect(dialogo(page)).toBeHidden();
    const crear = s.cuerpos.filter((c) => c.action === 'crear');
    expect(crear).toHaveLength(1);
    const enviado = crear[0].movimiento;
    console.log('payload crear:', JSON.stringify(enviado));
    expect(enviado).toMatchObject({
      fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      tipo: 'trasiego', origen: 'A5', destino: 'B2', lot_code: '25MEKMP-1',
      vintage_year: 2025, volumen_l: 7400, merma_l: 0,
      nota: 'trasiego con aireación', fuente: 'manual',
    });
    expect(enviado.client_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.keys(enviado).sort()).toEqual([
      'client_id', 'destino', 'fecha', 'fuente', 'lot_code', 'merma_l',
      'nota', 'origen', 'tipo', 'vintage_year', 'volumen_l',
    ]);

    // The plan and the panel now read the server's log, not a local guess.
    await expect(page.locator('#tanques-panel h2')).toHaveText('B2');
    await expect(page.locator('#tanques-panel')).toContainText('25MEKMP-1');
    await expect(page.locator('#tanques-panel')).toContainText('7,400 L');

    // Undo: the row is annulled, never deleted, and the panel shows that.
    await expect(toast(page)).toContainText('Trasiego registrado: A5 a B2');
    await toast(page).locator('.tanques-toast-accion').click();
    await expect(page.locator('#tanques-panel .tanques-alert')).toContainText('Vacío', { timeout: 10_000 });
    const anular = s.cuerpos.filter((c) => c.action === 'anular');
    console.log('payload anular:', JSON.stringify(anular));
    expect(anular).toHaveLength(1);
    expect(s.movimientos.find((m) => m.id === anular[0].id).anulado).toBe(true);
    await expect(toast(page)).toContainText('Movimiento anulado');
  });

  test('a blend into an occupied tank is announced and recorded as an ensamble', async ({ page }) => {
    const s = servidor();
    await montar(page, s);

    await arrastrar(page, tanque('A1'), tanque('C5'));
    await expect(dialogo(page).locator('h2')).toHaveText('Ensamble');
    await expect(dialogo(page).locator('.tanques-alert').filter({ hasText: 'C5 ya tiene vino' }))
      .toBeVisible();
    await expect(dialogo(page).locator('[name="tipo"]')).toHaveValue('ensamble');
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('6000');
    await dialogo(page).locator('[name="merma_l"]').fill('100');
    await dialogo(page).locator('button[type="submit"]').click();

    await expect(dialogo(page)).toBeHidden();
    const enviado = s.cuerpos.filter((c) => c.action === 'crear')[0].movimiento;
    console.log('payload ensamble:', JSON.stringify(enviado));
    expect(enviado).toMatchObject({ tipo: 'ensamble', origen: 'A1', destino: 'C5', volumen_l: 6000, merma_l: 100 });
    // 12 700 + (6 000 - 100) = 18 600 L, as two lotes.
    await expect(page.locator('#tanques-panel')).toContainText('18,600 L');
    await expect(page.locator('#tanques-panel .tanques-comp div')).toHaveCount(2);
  });

  test('a tray lote is assigned by drag and posted as a recepcion', async ({ page }) => {
    const s = servidor();
    // The tray sits below the plan, so the window has to be tall enough to
    // hold both ends of the drag at once.
    await montar(page, s, { alto: 1400 });

    const chip = page.locator('#tanques-lotes [data-lote="25CSKMP-9"]');
    await expect(chip).toBeVisible();
    // Only the lotes the log does not place, and only the newest vendimia.
    await expect(page.locator('#tanques-lotes [data-lote]')).toHaveCount(1);

    await arrastrar(page, '#tanques-lotes [data-lote="25CSKMP-9"]', tanque('H1'));
    await expect(dialogo(page).locator('h2')).toHaveText('Asignar lote a tanque');
    // No source says how many litres arrived, so the field starts empty.
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('');
    await expect(dialogo(page).locator('[name="tipo"]')).toBeDisabled();
    await dialogo(page).locator('[name="volumen_l"]').fill('9000');
    await dialogo(page).locator('button[type="submit"]').click();

    await expect(dialogo(page)).toBeHidden();
    const enviado = s.cuerpos.filter((c) => c.action === 'crear')[0].movimiento;
    console.log('payload recepcion:', JSON.stringify(enviado));
    expect(enviado).toMatchObject({
      tipo: 'recepcion', origen: null, destino: 'H1',
      lot_code: '25CSKMP-9', vintage_year: 2025, volumen_l: 9000, merma_l: 0, fuente: 'manual',
    });
    await expect(page.locator('#tanques-panel')).toContainText('25CSKMP-9');
    // The lote now has a tank, so it leaves the tray.
    await expect(page.locator('#tanques-lotes [data-lote]')).toHaveCount(0);
  });

  test('Modo mover records a movement with two taps', async ({ page }) => {
    const s = servidor();
    await montar(page, s);

    await page.locator('#tanques-mover').click();
    await expect(page.locator('#tanques-mover')).toHaveAttribute('aria-pressed', 'true');
    await page.locator(tanque('A5')).click();
    await expect(toast(page)).toContainText('Origen: A5');
    await expect(page.locator('#tanques-plano [data-tanque="A5"]')).toHaveClass(/origen/);
    await page.locator(tanque('H1')).click();
    await expect(dialogo(page).locator('h2')).toHaveText('Registrar trasiego');
    await dialogo(page).locator('[data-cerrar]').click();
    await expect(dialogo(page)).toBeHidden();
    expect(s.cuerpos).toEqual([]);

    // The panel's own button arms the same gesture for a keyboard user.
    await page.locator('#tanques-plano [data-tanque="A5"]').click();
    await page.locator('#tanques-panel [data-accion="mover"]').click();
    await expect(page.locator('#tanques-panel [data-accion="mover"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator(tanque('B2')).click();
    await expect(dialogo(page)).toBeVisible();
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);
  });

  test('a keyboard user can record a movement without a pointer', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    // An SVG <g> with role=button gets no synthetic click from Enter, so the
    // plan needs its own key handling or Modo mover is mouse-only.
    await page.locator('#tanques-mover').click();
    await page.locator('#tanques-plano [data-tanque="A5"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tanques-plano [data-tanque="A5"]')).toHaveClass(/origen/);
    await page.locator('#tanques-plano [data-tanque="B2"]').focus();
    await page.keyboard.press(' ');
    await expect(dialogo(page)).toBeVisible();
    // The dialog is modal, so the focus is inside it and Escape closes it.
    await expect(dialogo(page).locator('[name="volumen_l"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialogo(page)).toBeHidden();
    expect(s.cuerpos).toEqual([]);
  });

  test('the client refuses what the server would refuse, before posting', async ({ page }) => {
    const s = servidor();
    await montar(page, s);

    await arrastrar(page, tanque('A5'), tanque('H1'));
    const vol = dialogo(page).locator('[name="volumen_l"]');
    // H1 holds 15 000 L and A5 has 14 200 L, so 14 200 is the default; ask for
    // more than the tank actually has.
    await vol.fill('99999');
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page).locator('.tanques-dialog-errores')).toContainText('excede el contenido del tanque A5');
    await expect(dialogo(page)).toBeVisible();
    expect(s.cuerpos).toEqual([]);     // nothing left the browser

    // Correct it and the same dialog goes through.
    await vol.fill('14200');
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);
  });

  test('an undo the log cannot honour shows the server reason', async ({ page }) => {
    const s = servidor();
    await montar(page, s);

    // Empty A5 into H1, then move it on to B2: annulling the first row would
    // leave the second overdrawn, and only the server can say so.
    await arrastrar(page, tanque('A5'), tanque('H1'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    const primero = s.movimientos[s.movimientos.length - 1].id;
    await arrastrar(page, tanque('H1'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();

    // The first row is still in H1's history, with its own Anular control.
    await page.locator('#tanques-plano [data-tanque="H1"]').click();
    const fila = page.locator(`#tanques-panel li[data-mov="${primero}"] [data-anular]`);
    await expect(fila).toBeVisible();
    await fila.click();
    await expect(toast(page)).toContainText('No se puede anular');
    await expect(toast(page)).toContainText('posterior');
    expect(s.movimientos.find((m) => m.id === primero).anulado).toBe(false);
  });

  test('a fast double tap on Registrar posts once', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    await arrastrar(page, tanque('A5'), tanque('B2'));
    const boton = dialogo(page).locator('button[type="submit"]');
    await boton.click({ force: true });
    await boton.click({ force: true }).catch(() => {});  // the dialog may already be gone
    await expect(dialogo(page)).toBeHidden();
    await page.waitForTimeout(300);
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);
  });

  test('an unconfirmed write is never reported as refused, and the retry reuses its key', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('abortar');

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(toast(page)).toContainText(/Revise la bit[áa]cora/, { timeout: 10_000 });
    await expect(toast(page)).not.toContainText('rechaz');
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(0);

    // Retry: the SAME client_id, so a server that had in fact written the row
    // answers with the row instead of writing a second one.
    await toast(page).locator('.tanques-toast-accion').click();
    await expect(toast(page)).toContainText('registrado', { timeout: 10_000 });
    const claves = s.cuerpos.filter((c) => c.action === 'crear').map((c) => c.movimiento.client_id);
    console.log('client_id por intento:', JSON.stringify(claves));
    expect(claves).toHaveLength(2);
    expect(claves[0]).toBe(claves[1]);
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(1);
  });

  test('a 503 with indeterminado reconciles against the log instead of guessing', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('indeterminado');
    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(toast(page)).toContainText('Revise la bitácora', { timeout: 10_000 });
    // The stand-in wrote nothing, and the re-read agrees, so the view is not
    // marked stale and the plan still shows A5 full.
    await expect(page.locator('#tanques-estado')).not.toContainText('Se registró el movimiento');
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(0);
  });

  test('cancelling a dialog whose write is in flight cannot double the movement', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('retener');

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    // The write is in flight: both ways out of the dialog are shut, because
    // repeating the gesture would send the same movement under a new key.
    await expect(dialogo(page).locator('button[type="submit"]')).toBeDisabled();
    await expect(dialogo(page).locator('[data-cerrar]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialogo(page)).toBeVisible();

    await page.waitForFunction(() => true);
    s.soltar();
    await expect(dialogo(page)).toBeHidden({ timeout: 10_000 });
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(1);
  });

  test('an unconfirmed write outlives its toast and keeps its key', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('abortar');

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    const banner = page.locator('#tanques-pendiente');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('Trasiego');
    await expect(banner).toContainText('A5 a B2');

    // The toast is transient; the banner is not. Dismissing the toast must not
    // take the pending intent with it.
    await toast(page).locator('.tanques-toast-cerrar').click();
    await expect(toast(page)).toBeHidden();
    await expect(banner).toBeVisible();

    await banner.locator('[data-pendiente="reintentar"]').click();
    await expect(banner).toBeHidden({ timeout: 10_000 });
    const claves = s.cuerpos.filter((c) => c.action === 'crear').map((c) => c.movimiento.client_id);
    expect(claves[0]).toBe(claves[1]);
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(1);
  });

  test('a vessel with no place on the plan can still receive wine', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    // I-4 CAVA is in the tray: it has no row or position in dim_tanque, so it
    // is a chip and not a tank on the floor.
    const chip = page.locator('#tanques-otras [data-ir-tanque="I-4 CAVA"]');
    await expect(chip).toBeVisible();

    // As a destination for an armed origin.
    await page.locator('#tanques-plano [data-tanque="A5"]').click();
    await page.locator('#tanques-panel [data-accion="mover"]').click();
    await chip.click();
    await expect(dialogo(page).locator('h2')).toHaveText('Registrar trasiego');
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('10000');
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    const enviado = s.cuerpos.filter((c) => c.action === 'crear')[0].movimiento;
    console.log('payload vasija de bandeja:', JSON.stringify(enviado));
    expect(enviado).toMatchObject({ origen: 'A5', destino: 'I-4 CAVA', volumen_l: 10000 });
    await expect(page.locator('#tanques-panel h2')).toHaveText('I-4 CAVA');

    // And as an origin: its chip is a drag source back onto the floor.
    await arrastrar(page, '#tanques-otras [data-ir-tanque="I-4 CAVA"]', tanque('B2'));
    await expect(dialogo(page)).toBeVisible();
    await expect(dialogo(page).locator('[name="volumen_l"]')).toHaveValue('7400');
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    const segundo = s.cuerpos.filter((c) => c.action === 'crear')[1].movimiento;
    expect(segundo).toMatchObject({ origen: 'I-4 CAVA', destino: 'B2', volumen_l: 7400 });
  });

  test('two unconfirmed writes keep two keys, and resolving one leaves the other', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('abortar', 'abortar');

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(1, { timeout: 10_000 });
    await arrastrar(page, tanque('A1'), tanque('H1'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator('#tanques-pendiente')).toContainText('A5 a B2');
    await expect(page.locator('#tanques-pendiente')).toContainText('A1 a H1');

    const claves = s.cuerpos.map((c) => c.movimiento.client_id);
    // Retrying the FIRST one must not touch the second's entry.
    await page.locator('#tanques-pendiente [data-clave="' + claves[0] + '"][data-pendiente="reintentar"]').click();
    await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#tanques-pendiente')).toContainText('A1 a H1');
    const reintento = s.cuerpos[s.cuerpos.length - 1].movimiento;
    expect(reintento.client_id).toBe(claves[0]);
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(1);
  });

  test('a write lost across a reload is reconciled from the log, not repeated', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    // The row commits, the answer is lost, and the re-read fails too.
    s.guion.push('perdido');
    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(1, { timeout: 10_000 });
    expect(s.movimientos.filter((m) => m.destino === 'B2')).toHaveLength(1);

    // The user reloads, which used to be the end of the idempotency key.
    await page.reload();
    await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
    await page.locator('.nav-tab[data-view="tanques"]').click();
    await page.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
    // The key is in the log, so the pending entry answers itself.
    await expect(toast(page)).toContainText('sí quedó registrado', { timeout: 10_000 });
    await expect(page.locator('#tanques-pendiente')).toHaveCount(0);
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);
    await expect(page.locator('#tanques-plano [data-tanque="B2"]')).toBeVisible();
  });

  test('an empty vessel the tray groups can still be filled, by name', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    // The 21 tibores, 7 Domecq tanks and 11 kegs share one chip each when
    // empty, so the picker is the only way to name one of them.
    await expect(page.locator('#tanques-otras')).toContainText('Tibores (21)');
    await page.locator('#tanques-plano [data-tanque="A5"]').click();
    await page.locator('#tanques-panel [data-accion="mover"]').click();
    const picker = page.locator('#tanques-destino');
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('Destino de A5');
    await picker.locator('select').selectOption('TIBOR 3');
    await picker.locator('[data-destino="usar"]').click();

    await expect(dialogo(page).locator('h2')).toHaveText('Registrar trasiego');
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    const enviado = s.cuerpos.filter((c) => c.action === 'crear')[0].movimiento;
    console.log('payload vasija agrupada:', JSON.stringify(enviado));
    expect(enviado).toMatchObject({ origen: 'A5', destino: 'TIBOR 3' });
    await expect(page.locator('#tanques-otras')).toContainText('TIBOR 3');
  });

  test('a stale view refuses the next write and offers the read instead', async ({ page }) => {
    const s = servidor();
    await montar(page, s);
    s.guion.push('sin-relectura');

    await arrastrar(page, tanque('A5'), tanque('B2'));
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    await expect(page.locator('#tanques-estado')).toContainText('no se pudo actualizar la vista',
      { ignoreCase: true, timeout: 10_000 });

    // The plan still shows the pre-write bodega, so recording against it would
    // write the same movement again under a new key.
    await arrastrar(page, tanque('A5'), tanque('B2'));
    await expect(page.locator('#tanques-dialogo')).toBeHidden();
    await expect(toast(page)).toContainText('La vista está desactualizada');
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(1);

    await toast(page).locator('.tanques-toast-accion').click();
    await expect(toast(page)).toContainText('Bitácora al día', { timeout: 10_000 });
    // With the log current, the next movement goes through as itself.
    await arrastrar(page, tanque('A5'), tanque('H1'));
    await expect(dialogo(page)).toBeVisible();
    await dialogo(page).locator('button[type="submit"]').click();
    await expect(dialogo(page)).toBeHidden();
    expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(2);
  });

  test('a refused retry keeps the key, because it proves nothing about the first try',
    async ({ page }) => {
      const s = servidor();
      await montar(page, s);
      s.guion.push('abortar', 'rechazar');

      await arrastrar(page, tanque('A5'), tanque('B2'));
      await dialogo(page).locator('button[type="submit"]').click();
      const banner = page.locator('#tanques-pendiente .tanques-alert');
      await expect(banner).toHaveCount(1, { timeout: 10_000 });

      // The session expires between the write and the retry: a 403 to THIS
      // request says nothing about whether the first one committed.
      await banner.locator('[data-pendiente="reintentar"]').click();
      await expect(toast(page)).toContainText('Sin permisos', { timeout: 10_000 });
      await expect(banner).toHaveCount(1);
      const claves = s.cuerpos.map((c) => c.movimiento.client_id);
      expect(claves[0]).toBe(claves[1]);

      // Only the user saying they checked, or the key turning up in the log,
      // retires the entry.
      await banner.locator('[data-pendiente="descartar"]').click();
      await expect(page.locator('#tanques-pendiente')).toHaveCount(0);
    });

  test('each unconfirmed write is its own stored key, so two tabs cannot erase each other',
    async ({ page, context }) => {
      const s = servidor();
      await montar(page, s);
      s.guion.push('abortar');
      await arrastrar(page, tanque('A5'), tanque('B2'));
      await dialogo(page).locator('button[type="submit"]').click();
      await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(1, { timeout: 10_000 });

      // One key per intent: a read-modify-write over a single list is what
      // lets a second tab drop the first tab's key.
      const claves = await page.evaluate(() => Object.keys(localStorage)
        .filter((k) => k.startsWith('xanic_tanques_pendiente:')));
      expect(claves).toHaveLength(1);
      expect(claves[0].slice('xanic_tanques_pendiente:'.length))
        .toBe(s.cuerpos[0].movimiento.client_id.toLowerCase());

      // A second tab, same origin and same storage, records its own.
      const otra = await context.newPage();
      // Its own window: a tank below the fold cannot be dragged onto.
      await otra.setViewportSize({ width: 1440, height: 1000 });
      await otra.route('**/api/tanques', (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, version: s.version, tanques: TANQUES, sinonimos: SINONIMOS, movimientos: s.movimientos }) });
        }
        return route.abort('failed');
      });
      await otra.goto('/');
      await otra.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
      await otra.locator('.nav-tab[data-view="tanques"]').click();
      await otra.waitForSelector('#tanques-plano .tanque', { timeout: 12_000 });
      await otra.locator(tanque('H1')).scrollIntoViewIfNeeded();
      await otra.locator(tanque('A1')).scrollIntoViewIfNeeded();
      const a1 = await otra.locator(tanque('A1')).boundingBox();
      const h1 = await otra.locator(tanque('H1')).boundingBox();
      await otra.mouse.move(a1.x + a1.width / 2, a1.y + a1.height / 2);
      await otra.mouse.down();
      await otra.mouse.move(a1.x + 20, a1.y + 20, { steps: 3 });
      await otra.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2, { steps: 6 });
      await otra.mouse.up();
      await expect(otra.locator('#tanques-dialogo')).toBeVisible();
      await otra.locator('#tanques-dialogo button[type="submit"]').click();
      await expect(otra.locator('#tanques-pendiente .tanques-alert')).toHaveCount(2, { timeout: 10_000 });

      // Back in the first tab: its own key is still there, beside the new one.
      await page.reload();
      await page.waitForSelector('#dashboard-content', { state: 'visible', timeout: 12_000 });
      await page.locator('.nav-tab[data-view="tanques"]').click();
      await expect(page.locator('#tanques-pendiente .tanques-alert')).toHaveCount(2, { timeout: 12_000 });
      await expect(page.locator('#tanques-pendiente')).toContainText('A5 a B2');
      await expect(page.locator('#tanques-pendiente')).toContainText('A1 a H1');
      await otra.close();
    });

  test('a lote armed here and placed elsewhere does not become a second reception',
    async ({ page }) => {
      const s = servidor();
      await montar(page, s);
      // Arm the tray lote and leave the gesture open.
      await page.locator('#tanques-lotes [data-lote="25CSKMP-9"]').click();
      await expect(page.locator('#tanques-lotes [data-lote="25CSKMP-9"]'))
        .toHaveAttribute('aria-pressed', 'true');

      // Another session records its reception into H1 and this tab re-reads.
      s.movimientos.push(mv({
        fecha: '2026-02-01', tipo: 'recepcion', destino: 'H1',
        lot_code: '25CSKMP-9', volumen_l: 9000,
      }));
      s.version += 1;
      await page.locator('.nav-tab[data-view="berry"]').click();
      await page.waitForTimeout(15_400);
      await page.locator('.nav-tab[data-view="tanques"]').click();
      await expect(page.locator('#tanques-lotes [data-lote="25CSKMP-9"]')).toHaveCount(0, { timeout: 10_000 });

      // The stale arm is gone, so a tap on a tank is a plain selection.
      await expect(toast(page)).toContainText('ya aparece en la bitácora');
      await page.locator(tanque('B2')).click();
      await expect(page.locator('#tanques-dialogo')).toBeHidden();
      expect(s.cuerpos.filter((c) => c.action === 'crear')).toHaveLength(0);

      // And if the lote is reached another way, the dialog says where it is
      // instead of repeating "sin tanque".
      await page.locator('#tanques-plano [data-tanque="H1"]').click();
      await expect(page.locator('#tanques-panel')).toContainText('25CSKMP-9');
    });

  test('a viewer has no write controls at all', async ({ page }) => {
    const s = servidor();
    await montar(page, s, { rol: 'viewer' });
    await expect(page.locator('#tanques-mover')).toHaveCount(0);
    await expect(page.locator('#tanques-lotes-bandeja')).toHaveCount(0);
    await expect(page.locator('#tanques-panel [data-accion]')).toHaveCount(0);
    await expect(page.locator('#tanques-panel [data-anular]')).toHaveCount(0);
    // And a drag does nothing: no dialog, no request.
    await arrastrar(page, tanque('A5'), tanque('B2'));
    await expect(page.locator('#tanques-dialogo')).toHaveCount(0);
    expect(s.cuerpos).toEqual([]);
    // The read-only tab still works.
    await expect(page.locator('#tanques-plano .tanque')).toHaveCount(72);
  });

  test('the dialog is usable at phone width', async ({ page }) => {
    const s = servidor();
    await montar(page, s, { ancho: 390 });
    // Dragging inside a plan that scrolls is what Modo mover exists for.
    await page.locator('#tanques-mover').click();
    await page.locator(tanque('A5')).click();
    await page.locator(tanque('B2')).click();
    await expect(dialogo(page)).toBeVisible();

    const caja = await dialogo(page).boundingBox();
    expect(caja.width).toBeLessThanOrEqual(390);
    const chicos = await page.$$eval(
      '#tanques-dialogo input, #tanques-dialogo select, #tanques-dialogo .tanques-btn',
      (els) => els.map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height < 44).length,
    );
    expect(chicos).toBe(0);
    const desborde = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });
});

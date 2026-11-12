// xd-6il - the in-app "Guía de Uso" must be true for every user of the live
// site, not only for someone holding the repo. The 2026-11-12 audit found it
// told users to run `npm start` and open localhost, named the database vendor,
// listed 4 of 11 tabs and described a "Movimientos de tanque" upload that does
// not exist. This test pins the guide to what index.html actually renders:
// every nav tab, every upload button, the header actions, and no developer-only
// instruction.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function helpBody() {
  const start = html.indexOf('<div id="help-modal"');
  assert.ok(start >= 0, 'help modal present');
  const end = html.indexOf('<!-- App entry point', start);
  return html.slice(start, end);
}
const decode = (s) => s.replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
  .replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú')
  .replace(/&ntilde;/g, 'ñ').replace(/&amp;/g, '&');
const text = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const guide = helpBody();
const guideText = text(guide);

describe('Guía de Uso (xd-6il)', () => {
  test('keeps the help modal structure and classes', () => {
    for (const cls of ['help-card', 'help-header', 'help-title', 'help-close', 'help-body', 'help-section']) {
      assert.ok(guide.includes(`class="${cls}"`), `missing .${cls}`);
    }
  });

  test('assumes no repo, terminal or backend console', () => {
    const banned = [/npm/i, /localhost/i, /supabase/i, /\.env/i, /\bgit\b/i, /vercel/i,
      /consola/i, /terminal/i, /<pre>/i, /servidor local/i, /api\//i, /migraci/i];
    for (const re of banned) assert.ok(!re.test(guide), `guide mentions ${re}`);
  });

  test('names every navigation tab the site shows', () => {
    const nav = html.slice(html.indexOf('<nav class="nav-tabs"'), html.indexOf('</nav>'));
    const tabs = [...nav.matchAll(/data-view="[^"]+">([^<]+)</g)].map((m) => decode(m[1]).trim());
    assert.ok(tabs.length >= 11, `expected the 11 tabs, read ${tabs.length}`);
    for (const t of tabs) assert.ok(guideText.includes(t), `tab "${t}" missing from guide`);
  });

  test('names every save-to-database upload by its button label', () => {
    for (const label of ['Sincronizar WineXRay', 'Cargar WineXRay', 'Cargar Recepción de Tanque',
      'Cargar Pre-recepción', 'Cargar Seguimiento de Maduración']) {
      assert.ok(html.includes(label), `index.html no longer has "${label}": update this test`);
      assert.ok(guideText.includes(label), `upload "${label}" missing from guide`);
    }
  });

  test('describes header actions, session view, exports, saved views and phone use', () => {
    for (const s of ['Ver en esta sesión', 'Recargar Datos', 'Exportar Vista', 'PNG', 'PDF',
      'Ctrl K', 'Demo', 'Guardar', 'Filtros', 'Conectar Líneas', 'Por Varietal', 'Por Origen',
      'Modo mover', 'Cerrar sesión']) {
      assert.ok(guideText.includes(s), `"${s}" missing from guide`);
    }
  });

  test('says what a user without the lab role sees instead', () => {
    assert.match(guideText, /laboratorio/i);
    assert.match(guideText, /sin la cuenta de laboratorio|solo la cuenta de laboratorio/i);
  });

  test('drops the upload that does not exist', () => {
    assert.ok(!/Movimientos de tanque/i.test(guideText), 'no "Movimientos de tanque" upload exists');
  });
});

// MT.22 — Per-table editing descriptors (berry / wine / preferment).
//
// Pairs with MT.21 (RowEditor pure helpers + composite-key shape).
// Here we focus on the per-table descriptors landing in Stages 7.3 / 7.4
// / 7.5: that each descriptor's table name + conflict keys + JS↔DB map
// are internally consistent, and that an end-to-end submit through
// RowEditor produces the right /api/row body for each table.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function installDomStub() {
  globalThis.document = { getElementById: () => null };
}
function uninstallDomStub() { delete globalThis.document; }

// Descriptors and helpers
const { BerryEdit }       = await import('../js/berryEdit.js');
const { WineEdit }        = await import('../js/wineEdit.js');
const { PrefermentEdit }  = await import('../js/prefermentEdit.js');
const { RowEditor }       = await import('../js/rowEditor.js');
const {
  JS_TO_DB_BERRY, JS_TO_DB_WINE, JS_TO_DB_PREF,
} = await import('../js/config.js');
const { Tables } = await import('../js/tables.js');

// ── Descriptor invariants ─────────────────────────────────────────

describe('MT.22 — descriptor invariants', () => {
  for (const [name, mod, jsToDb, expectedTable, expectedConflict] of [
    ['BerryEdit',     BerryEdit,      JS_TO_DB_BERRY, 'wine_samples',     ['sample_id', 'sample_date', 'sample_seq']],
    ['WineEdit',      WineEdit,       JS_TO_DB_WINE,  'wine_samples',     ['sample_id', 'sample_date', 'sample_seq']],
    ['PrefermentEdit',PrefermentEdit, JS_TO_DB_PREF,  'prefermentativos', ['report_code']],
  ]) {
    describe(`${name}`, () => {
      const d = mod.descriptor;

      it('targets the expected table', () => {
        assert.equal(d.table, expectedTable);
      });

      it('uses the expected conflict keys', () => {
        assert.deepEqual(d.conflictKeys, expectedConflict);
      });

      it('jsToDb is the corresponding constant export', () => {
        assert.strictEqual(d.jsToDb, jsToDb);
      });

      it('every fieldMap key has a jsToDb mapping', () => {
        const missing = Object.keys(d.fieldMap).filter(k => !(k in d.jsToDb));
        assert.deepEqual(missing, [], `Field-map keys without a DB column: ${missing.join(', ')}`);
      });

      it('every conflict-key column is reachable from some jsToDb entry', () => {
        const dbCols = new Set(Object.values(d.jsToDb));
        const missing = d.conflictKeys.filter(c => !dbCols.has(c));
        assert.deepEqual(missing, [], `Conflict cols not in jsToDb values: ${missing.join(', ')}`);
      });

      it('does not project audit columns (server is the only writer)', () => {
        const dbCols = new Set(Object.values(d.jsToDb));
        assert.equal(dbCols.has('last_edited_at'), false);
        assert.equal(dbCols.has('last_edited_by'), false);
      });

      it('exposes the standard delegating methods', () => {
        assert.equal(typeof mod.open,         'function');
        assert.equal(typeof mod.close,        'function');
        assert.equal(typeof mod.submit,       'function');
        assert.equal(typeof mod.remove,       'function');
        assert.equal(typeof mod.refreshDirty, 'function');
      });
    });
  }
});

// ── End-to-end submit body shape (per descriptor) ─────────────────
// Each test injects an initial snapshot + a stubbed readForm that returns
// dirty values, then calls RowEditor.submit and asserts the wire body.

describe('MT.22 — submit body shape per descriptor', () => {
  let originalFetch, captured;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    captured = null;
    installDomStub();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    uninstallDomStub();
  });

  function captureFetch() {
    globalThis.fetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ ok: true, row: {} }) };
    };
  }

  it('berry: composite key + dirty chemistry, no audit columns', async () => {
    captureFetch();
    const d = BerryEdit.descriptor;
    // Snapshot must mirror the readForm shape so only intentional changes
    // count as dirty (otherwise undefined→value would inflate the diff).
    d._state = { initial: {
      sampleId: 'CSMX-5B-1', sampleDate: '2026-01-01', sampleSeq: 1,
      vintage: 2026, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
      crushDate: null, daysPostCrush: 28,
      brix: 24, pH: 3.6, ta: 6.5, tANT: 1200,
      berryFW: null, anthocyanins: null,
      colorL: null, colorA: null, colorB: null, colorI: null, colorT: null,
      belowDetection: false,
      notes: null,
      lastEditedAt: '2026-04-01T00:00:00Z',
    }};
    const origRead = d.readForm;
    d.readForm = () => ({
      vintage: 2026, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
      crushDate: null, daysPostCrush: 28,
      brix: 26.3,        // dirty
      pH: 3.6, ta: 6.5,
      tANT: 1450,        // dirty
      berryFW: null, anthocyanins: null,
      colorL: null, colorA: null, colorB: null, colorI: null, colorT: null,
      belowDetection: false,
      notes: 'edited',   // dirty
    });
    // stub afterSave/reload so the submit completes without errors
    const origAfterSave = d.afterSave; const origReload = d.reload;
    d.afterSave = () => {}; d.reload = async () => {};
    // also avoid the "no dirty -> early return" by forcing isDemoMode false
    const origIsDemo = d.isDemoMode; d.isDemoMode = () => false;

    try {
      await RowEditor.submit(d);
    } finally {
      d.readForm   = origRead;
      d.afterSave  = origAfterSave;
      d.reload     = origReload;
      d.isDemoMode = origIsDemo;
    }

    assert.ok(captured, 'fetch should have fired');
    assert.equal(captured.url, '/api/row');
    assert.equal(captured.body.table, 'wine_samples');
    assert.equal(captured.body.action, 'update');

    const row = captured.body.row;
    assert.equal(row.sample_id,   'CSMX-5B-1');
    assert.equal(row.sample_date, '2026-01-01');
    assert.equal(row.sample_seq,  1);
    assert.equal(row.brix,  26.3);
    assert.equal(row.tant,  1450);
    assert.equal(row.notes, 'edited');
    // unchanged columns absent
    assert.ok(!('ph' in row));
    assert.ok(!('ta' in row));
    assert.ok(!('vintage_year' in row));
    // audit columns never on the wire
    assert.ok(!('last_edited_at' in row));
    assert.ok(!('last_edited_by' in row));
  });

  it('wine: composite key + dirty chemistry only', async () => {
    captureFetch();
    const d = WineEdit.descriptor;
    d._state = { initial: {
      codigoBodega: '25-CSMX-5B', fecha: '2026-02-15', sampleSeq: 1,
      vintage: 2026, variedad: 'Cabernet Sauvignon', proveedor: 'Monte Xanic (VDG)',
      tanque: 'T05', crushDate: null, daysPostCrush: 5,
      brix: 0, pH: 3.5, at: 5.8,
      antoWX: 800, freeANT: 200, boundANT: null,
      pTAN: 1500, iRPs: null, iptSpica: 35,
      colorL: null, colorA: null, colorB: null, colorI: null, colorT: null,
      notes: null,
      sampleType: 'Recepcion',
    }};
    const origRead = d.readForm;
    d.readForm = () => ({
      vintage: 2026, variedad: 'Cabernet Sauvignon', proveedor: 'Monte Xanic (VDG)',
      tanque: 'T05', crushDate: null, daysPostCrush: 5,
      brix: 0, pH: 3.5, at: 5.8,
      antoWX: 950,    // dirty
      freeANT: 200, boundANT: null,
      pTAN: 1500, iRPs: null,
      iptSpica: 38,   // dirty
      colorL: null, colorA: null, colorB: null, colorI: null, colorT: null,
      notes: null,
    });
    const origAS = d.afterSave; const origRL = d.reload; const origID = d.isDemoMode;
    d.afterSave = () => {}; d.reload = async () => {}; d.isDemoMode = () => false;

    try { await RowEditor.submit(d); }
    finally { d.readForm = origRead; d.afterSave = origAS; d.reload = origRL; d.isDemoMode = origID; }

    const row = captured.body.row;
    assert.equal(captured.body.table, 'wine_samples');
    assert.equal(row.sample_id,   '25-CSMX-5B');
    assert.equal(row.sample_date, '2026-02-15');
    assert.equal(row.sample_seq,  1);
    assert.equal(row.tant, 950);
    assert.equal(row.ipt,  38);
    // unchanged absent
    assert.ok(!('brix' in row));
    assert.ok(!('ph' in row));
    assert.ok(!('fant' in row));
  });

  it('preferment: single conflict key + dirty pH/temp', async () => {
    captureFetch();
    const d = PrefermentEdit.descriptor;
    d._state = { initial: {
      reportCode: 'rc-uuid-1', fecha: '2026-03-10', codigoBodega: '25-CSMX-5B',
      tanque: 'T05', variedad: 'Cabernet Sauvignon',
      vintage: 2026, brix: 0, pH: 3.2, at: 5.5, temp: 18.0, antoWX: 600,
      notes: null,
    }};
    const origRead = d.readForm;
    d.readForm = () => ({
      fecha: '2026-03-10', codigoBodega: '25-CSMX-5B', tanque: 'T05',
      variedad: 'Cabernet Sauvignon', vintage: 2026,
      brix: 0,
      pH: 3.4,    // dirty
      at: 5.5,
      temp: 22.5, // dirty
      antoWX: 600, notes: null,
    });
    const origAS = d.afterSave; const origRL = d.reload; const origID = d.isDemoMode;
    d.afterSave = () => {}; d.reload = async () => {}; d.isDemoMode = () => false;

    try { await RowEditor.submit(d); }
    finally { d.readForm = origRead; d.afterSave = origAS; d.reload = origRL; d.isDemoMode = origID; }

    const row = captured.body.row;
    assert.equal(captured.body.table, 'prefermentativos');
    assert.equal(row.report_code, 'rc-uuid-1');
    assert.equal(row.ph,          3.4);
    assert.equal(row.temperature, 22.5);
    assert.ok(!('brix' in row));
    assert.ok(!('ta'   in row));
    assert.ok(!('tant' in row));
  });
});

// ── Delete path (preferment, single conflict key) ─────────────────

describe('MT.22 — preferment delete posts only the report_code key', () => {
  let originalFetch, captured, originalConfirm;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConfirm = globalThis.confirm;
    captured = null;
    installDomStub();
    globalThis.confirm = () => true;
    globalThis.fetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ ok: true, deleted: 1 }) };
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = originalConfirm;
    uninstallDomStub();
  });

  it('produces { table, action: delete, row: { report_code } }', async () => {
    const d = PrefermentEdit.descriptor;
    d._state = { initial: {
      reportCode: 'rc-uuid-2', fecha: '2026-03-10', codigoBodega: '25-CSMX-5B',
      brix: 0, pH: 3.2, at: 5.5, temp: 18.0,
    }};
    const origAS = d.afterSave; const origRL = d.reload; const origID = d.isDemoMode;
    d.afterSave = () => {}; d.reload = async () => {}; d.isDemoMode = () => false;
    try { await RowEditor.remove(d); }
    finally { d.afterSave = origAS; d.reload = origRL; d.isDemoMode = origID; }

    assert.equal(captured.body.table, 'prefermentativos');
    assert.equal(captured.body.action, 'delete');
    assert.deepEqual(captured.body.row, { report_code: 'rc-uuid-2' });
  });
});

// ── Non-lab role: rendered table omits row-clickable ──────────────
// PLAN.md §7.8 calls for verifying that non-lab roles cannot click.
// The contract is enforced at render time: Auth.canWrite() === false
// means the row markup never gets the row-clickable class, so no
// click handler can ever fire BerryEdit.open / WineEdit.open / etc.

describe('MT.22 — render-time role gate', () => {
  let saved;
  beforeEach(async () => {
    // Minimal DOM stub — we capture innerHTML rather than walking it.
    const fakeContainer = { innerHTML: '' };
    saved = { document: globalThis.document };
    globalThis.document = {
      getElementById: (id) => {
        if (id === 'berry-table-body') return fakeContainer;
        if (id === 'berry-table-count') return { textContent: '' };
        if (id === 'berry-table-footnote') return { style: {} };
        return null;
      },
      // Mimic the browser's textContent → innerHTML escape that
      // Tables._esc relies on for HTML safety.
      createElement: () => {
        const obj = { _t: '', _h: '' };
        Object.defineProperty(obj, 'textContent', {
          set(v) {
            this._t = String(v);
            this._h = this._t
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
          get() { return this._t; },
        });
        Object.defineProperty(obj, 'innerHTML', {
          get() { return this._h; },
          set(v) { this._h = v; },
        });
        return obj;
      },
    };
    globalThis._fakeBerryContainer = fakeContainer;
  });
  afterEach(() => {
    globalThis.document = saved.document;
    delete globalThis._fakeBerryContainer;
  });

  async function renderBerryWith(role) {
    const { Auth }     = await import('../js/auth.js');
    const { DemoMode } = await import('../js/demoMode.js');
    const origRole = Auth.role; const origDemo = DemoMode.isActive;
    Auth.role = role;
    DemoMode.isActive = () => false;
    try {
      Tables.updateBerryTable([{
        sampleId: 'CSMX-5B-1', sampleDate: '2026-01-01', sampleSeq: 1,
        vintage: 2026, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
        brix: 24, pH: 3.6, ta: 6.5, tANT: 1200, berryFW: 1.5, daysPostCrush: 28,
      }]);
    } finally {
      Auth.role = origRole;
      DemoMode.isActive = origDemo;
    }
    return globalThis._fakeBerryContainer.innerHTML;
  }

  it('lab role sees row-clickable + composite data-sample attributes', async () => {
    const html = await renderBerryWith('lab');
    assert.match(html, /class="row-clickable"/);
    assert.match(html, /data-sample-id="CSMX-5B-1"/);
    assert.match(html, /data-sample-date="2026-01-01"/);
    assert.match(html, /data-sample-seq="1"/);
  });

  it('viewer role sees no row-clickable class and no data-sample attributes', async () => {
    const html = await renderBerryWith('viewer');
    assert.doesNotMatch(html, /class="row-clickable"/);
    assert.doesNotMatch(html, /data-sample-id=/);
  });

  it('admin role sees no row-clickable class (write gate is lab-only)', async () => {
    const html = await renderBerryWith('admin');
    assert.doesNotMatch(html, /class="row-clickable"/);
  });
});

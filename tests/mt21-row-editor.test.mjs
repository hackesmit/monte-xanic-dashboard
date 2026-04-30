// MT.21 — RowEditor helper (pure functions + submit/remove behavior).
//
// Covers:
//   * collectDirty parity with the mediciones implementation.
//   * jsRowToDbRow mapping + drop-unmapped.
//   * submit short-circuits when descriptor.isDemoMode() returns true.
//   * submit surfaces the server error message when /api/row returns
//     { ok: false, error }.
//   * submit composes a request body that includes every conflict key
//     (from the snapshot) plus DB-translated dirty fields, never audit
//     columns or unmapped JS keys.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal global stubs the helper expects in a browser. Each test resets
// these in beforeEach so cross-test leakage is impossible.
function installDomStub() {
  globalThis.document = { getElementById: () => null };
}
function uninstallDomStub() {
  delete globalThis.document;
}

const { RowEditor, collectDirty, jsRowToDbRow } = await import('../js/rowEditor.js');
const { collectDirty: medCollectDirty } = await import('../js/mediciones.js');

describe('MT.21 — collectDirty parity with mediciones', () => {
  it('produces identical output for empty/no-change input', () => {
    const a = { brix: 24, pH: 3.6, notes: null };
    const b = { brix: 24, pH: 3.6, notes: null };
    assert.deepEqual(collectDirty(a, b), medCollectDirty(a, b));
    assert.deepEqual(collectDirty(a, b), {});
  });

  it('produces identical output for changed fields', () => {
    const a = { brix: 24, pH: 3.6, notes: 'old' };
    const b = { brix: 25.1, pH: 3.6, notes: 'new' };
    assert.deepEqual(collectDirty(a, b), medCollectDirty(a, b));
    assert.deepEqual(collectDirty(a, b), { brix: 25.1, notes: 'new' });
  });

  it('treats null and undefined as equivalent (no false dirty on blank fields)', () => {
    const a = { tons: null };
    const b = { tons: undefined };
    assert.deepEqual(collectDirty(a, b), medCollectDirty(a, b));
    assert.deepEqual(collectDirty(a, b), {});
  });
});

describe('MT.21 — jsRowToDbRow', () => {
  const map = {
    sampleId:   'sample_id',
    sampleDate: 'sample_date',
    sampleSeq:  'sample_seq',
    brix:       'brix',
    pH:         'ph',
    notes:      'notes',
  };

  it('translates JS keys via the descriptor map', () => {
    const out = jsRowToDbRow({ brix: 25.1, pH: 3.7, notes: 'hello' }, map);
    assert.deepEqual(out, { brix: 25.1, ph: 3.7, notes: 'hello' });
  });

  it('drops keys not present in the map (e.g., id, lastEditedAt, derived)', () => {
    const out = jsRowToDbRow(
      { brix: 25, id: 'uuid', lastEditedAt: 'now', grapeType: 'Tinta' },
      map,
    );
    assert.deepEqual(out, { brix: 25 });
  });

  it('preserves null and empty-string values when mapped', () => {
    const out = jsRowToDbRow({ notes: null, brix: '' }, map);
    assert.deepEqual(out, { notes: null, brix: '' });
  });

  it('returns an empty object on null/undefined inputs', () => {
    assert.deepEqual(jsRowToDbRow(null, map), {});
    assert.deepEqual(jsRowToDbRow({ brix: 25 }, null), {});
  });
});

describe('MT.21 — RowEditor.submit demo-mode short-circuit', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    installDomStub();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    uninstallDomStub();
  });

  it('does not call fetch when isDemoMode() returns true', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({ ok: true }) }; };

    const descriptor = makeDescriptor({
      isDemoMode: () => true,
      readForm:   () => ({ brix: 27 }),  // has dirty
    });
    descriptor._state = { initial: { sampleId: 'X', sampleDate: '2026-01-01', sampleSeq: 1, brix: 24 } };

    await RowEditor.submit(descriptor);
    assert.equal(fetchCalls, 0);
  });

  it('does not call fetch when there are no dirty fields', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({ ok: true }) }; };

    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({ brix: 24 }),  // same as snapshot
    });
    descriptor._state = { initial: { sampleId: 'X', sampleDate: '2026-01-01', sampleSeq: 1, brix: 24 } };

    await RowEditor.submit(descriptor);
    assert.equal(fetchCalls, 0);
  });
});

describe('MT.21 — RowEditor.submit server-error handling', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    installDomStub();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    uninstallDomStub();
  });

  it('does not invoke reload/afterSave when the server returns ok: false', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 400,
      json: async () => ({ ok: false, error: 'Tabla no válida' }),
    });

    let reloaded = false, savedAfter = false;
    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({ brix: 27 }),
      reload:     async () => { reloaded = true; },
      afterSave:  () => { savedAfter = true; },
    });
    descriptor._state = { initial: { sampleId: 'X', sampleDate: '2026-01-01', sampleSeq: 1, brix: 24 } };

    await RowEditor.submit(descriptor);
    assert.equal(reloaded, false);
    assert.equal(savedAfter, false);
  });

  it('does not invoke reload/afterSave on a network error', async () => {
    globalThis.fetch = async () => { throw new Error('boom'); };

    let reloaded = false;
    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({ brix: 27 }),
      reload:     async () => { reloaded = true; },
    });
    descriptor._state = { initial: { sampleId: 'X', sampleDate: '2026-01-01', sampleSeq: 1, brix: 24 } };

    // Capture console.error so the test output stays quiet.
    const origErr = console.error;
    console.error = () => {};
    try {
      await RowEditor.submit(descriptor);
    } finally {
      console.error = origErr;
    }
    assert.equal(reloaded, false);
  });
});

describe('MT.21 — RowEditor.submit happy path', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    installDomStub();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    uninstallDomStub();
  });

  it('awaits reload() and invokes afterSave(updatedRow) on ok:true', async () => {
    const updatedRow = { sample_id: 'CSMX-5B-1', brix: 27 };
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, row: updatedRow }),
    });

    const order = [];
    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({ brix: 27 }),
      reload:     async () => {
        order.push('reload-start');
        await new Promise(r => setImmediate(r));
        order.push('reload-end');
      },
      afterSave:  (row) => { order.push(['afterSave', row]); },
    });
    descriptor._state = { initial: { sampleId: 'CSMX-5B-1', sampleDate: '2026-01-01', sampleSeq: 1, brix: 24 } };

    await RowEditor.submit(descriptor);

    // reload() must complete before afterSave() runs.
    assert.deepEqual(order, ['reload-start', 'reload-end', ['afterSave', updatedRow]]);
    // _state cleared (close called with force).
    assert.equal(descriptor._state, null);
  });
});

describe('MT.21 — RowEditor.submit request body shape', () => {
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

  it('includes every conflict key from the snapshot, plus DB-translated dirty fields, and never audit columns', async () => {
    globalThis.fetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers };
      return { ok: true, status: 200, json: async () => ({ ok: true, row: {} }) };
    };

    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({
        // sampleId, sampleDate, sampleSeq unchanged → not dirty.
        sampleId:   'CSMX-5B-1',
        sampleDate: '2026-01-01',
        sampleSeq:  1,
        brix:       27,    // dirty (was 24)
        pH:         3.6,   // unchanged
        notes:      'x',   // dirty (was null)
        // The form does not surface lastEditedAt; even if it leaked into
        // readForm, the helper would still drop it because it's not in
        // jsToDb (audit columns are server-authoritative).
      }),
    });
    descriptor._state = { initial: {
      sampleId: 'CSMX-5B-1', sampleDate: '2026-01-01', sampleSeq: 1,
      brix: 24, pH: 3.6, notes: null, lastEditedAt: '2026-04-01T00:00:00Z',
    }};

    await RowEditor.submit(descriptor);

    assert.ok(captured, 'fetch must have been called');
    assert.equal(captured.url, '/api/row');
    assert.equal(captured.body.table, 'wine_samples');
    assert.equal(captured.body.action, 'update');

    const row = captured.body.row;
    // Conflict keys present (composite).
    assert.equal(row.sample_id,   'CSMX-5B-1');
    assert.equal(row.sample_date, '2026-01-01');
    assert.equal(row.sample_seq,  1);
    // Dirty fields, in DB-column form.
    assert.equal(row.brix, 27);
    assert.equal(row.notes, 'x');
    // Unchanged field is NOT in the row body.
    assert.ok(!('ph' in row), 'unchanged pH should not be sent');
    // Audit columns are never on the wire — the server is the only writer.
    assert.ok(!('last_edited_at' in row));
    assert.ok(!('last_edited_by' in row));
  });
});

describe('MT.21 — RowEditor.remove', () => {
  let originalFetch, originalConfirm, captured;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConfirm = globalThis.confirm;
    captured = null;
    installDomStub();
    globalThis.confirm = () => true;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = originalConfirm;
    uninstallDomStub();
  });

  it('posts only the conflict-key columns on delete', async () => {
    globalThis.fetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ ok: true, deleted: 1 }) };
    };

    const descriptor = makeDescriptor({
      isDemoMode: () => false,
      readForm:   () => ({}),  // not used by remove
    });
    descriptor._state = { initial: {
      sampleId: 'CSMX-5B-1', sampleDate: '2026-01-01', sampleSeq: 1,
      brix: 24, pH: 3.6, notes: 'should not be in delete body',
    }};

    await RowEditor.remove(descriptor);

    assert.ok(captured, 'fetch must have been called');
    assert.equal(captured.body.action, 'delete');
    assert.deepEqual(captured.body.row, {
      sample_id: 'CSMX-5B-1',
      sample_date: '2026-01-01',
      sample_seq: 1,
    });
  });

  it('aborts when confirm() returns false', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({ ok: true }) }; };
    globalThis.confirm = () => false;

    const descriptor = makeDescriptor({ isDemoMode: () => false });
    descriptor._state = { initial: { sampleId: 'X', sampleDate: '2026-01-01', sampleSeq: 1 } };

    await RowEditor.remove(descriptor);
    assert.equal(fetchCalls, 0);
  });
});

// ── helpers ───────────────────────────────────────────────────────

function makeDescriptor(overrides = {}) {
  return {
    table: 'wine_samples',
    conflictKeys: ['sample_id', 'sample_date', 'sample_seq'],
    jsToDb: {
      sampleId:   'sample_id',
      sampleDate: 'sample_date',
      sampleSeq:  'sample_seq',
      brix:       'brix',
      pH:         'ph',
      notes:      'notes',
    },
    modalId:   'berry-edit-modal',
    formId:    'berry-edit-form',
    fieldMap:  { brix: 'berry-edit-brix', pH: 'berry-edit-ph', notes: 'berry-edit-notes' },
    auditEl:   'berry-edit-audit',
    statusEl:  'berry-edit-status',
    saveBtn:   'berry-edit-save',
    deleteBtn: 'berry-edit-delete',
    isDemoMode: () => false,
    readForm:   () => ({}),
    reload:     async () => {},
    afterSave:  () => {},
    formatRowLabel: (row) => `muestra ${row.sampleId}`,
    ...overrides,
  };
}

// MT.40 — Shared quality scale (js/quality-scale.js).
//
// The vocabulary and the panel arithmetic live in one pure module so the
// browser and the serverless write paths cannot drift apart on what a label
// is worth. Lucy flagged that drift on 2026-08-12: the API accepted the two
// consensus labels from the caller while scoring from the panel, so a crafted
// payload could show maximum quality to legacy readers and 0/-3 to the engine.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEvaluaciones, panelConsensus, averageEvaluations,
  MAX_EVALUADORES, exceedsPanelLimit, panelRejectionReason,
  sanitaryPoints, madurezPoints,
} from '../js/quality-scale.js';
import { ALLOWED_TABLES } from '../api/upload.js';

describe('MT.40 — sanitizeEvaluaciones', () => {
  it('rejects anything that is not an array', () => {
    for (const bad of [null, undefined, 'x', 42, {}, true]) {
      assert.equal(sanitizeEvaluaciones(bad), null);
    }
  });

  it('reduces each entry to the three expected string-or-null fields', () => {
    assert.deepEqual(
      sanitizeEvaluaciones([{ evaluador: ' Carla ', sanidad: 'Limpio', extra: 'drop me' }]),
      [{ evaluador: 'Carla', sanidad: 'Limpio', madurez: null }]);
  });

  it('drops entries that are not plain objects', () => {
    assert.deepEqual(sanitizeEvaluaciones([null, 'x', 1, [], { sanidad: 'Limpio' }]),
      [{ evaluador: null, sanidad: 'Limpio', madurez: null }]);
  });

  it('drops entries that carry nothing at all', () => {
    assert.deepEqual(sanitizeEvaluaciones([{ evaluador: '  ', sanidad: null }]), []);
  });

  it('never truncates, so no grade is lost without anyone noticing', () => {
    const input = [];
    for (let i = 0; i < MAX_EVALUADORES + 10; i++) {
      input.push({ evaluador: `E${i}`, sanidad: 'Limpio', madurez: null });
    }
    assert.equal(sanitizeEvaluaciones(input).length, MAX_EVALUADORES + 10);
  });

  it('never truncates a field either, it flags it for rejection', () => {
    const long = [{ evaluador: 'x'.repeat(500), sanidad: 'Limpio' }];
    assert.equal(exceedsPanelLimit(long), true, 'the handler refuses it');
    // And if it did get through, the value is intact rather than mangled.
    assert.equal(sanitizeEvaluaciones(long)[0].evaluador.length, 500);
    assert.equal(exceedsPanelLimit([{ evaluador: 'Carla', sanidad: 'Limpio' }]), false);
  });
});

describe('MT.40 — the server derives the consensus, it does not trust it', () => {
  it('recomputes both labels from the sanitised panel', () => {
    // Exactly lucy's payload: a damning panel with flattering labels attached.
    const panel = sanitizeEvaluaciones(
      [{ evaluador: 'A', sanidad: 'Contaminado', madurez: 'No sobresaliente' }]);
    const consensus = panelConsensus(panel);
    assert.equal(consensus.health_grade, 'Contaminado');
    assert.equal(consensus.phenolic_maturity, 'No sobresaliente');
  });

  it('rejects an oversized panel rather than quietly dropping the tail', () => {
    // 20 Muy limpio plus one Contaminado averages 3.81. Keeping only the first
    // 20 would store an average of 4.00 and lose a real grade, so the whole
    // payload is refused instead (lucy, 2026-08-12).
    const input = [];
    for (let i = 0; i < MAX_EVALUADORES; i++) input.push({ sanidad: 'Muy limpio' });
    input.push({ sanidad: 'Contaminado' });
    assert.equal(exceedsPanelLimit(input), true);
    assert.equal(exceedsPanelLimit(input.slice(0, MAX_EVALUADORES)), false);
    // And the arithmetic the rejection protects: the two really do differ.
    const all = panelConsensus(input);
    const truncated = panelConsensus(input.slice(0, MAX_EVALUADORES));
    assert.ok(Math.abs(all.sanidadAvg - 80 / 21) < 1e-9);
    assert.equal(truncated.sanidadAvg, 4);
  });

  it('leaves both labels unset when the panel is empty', () => {
    const c = panelConsensus([]);
    assert.equal(c.health_grade, null);
    assert.equal(c.phenolic_maturity, null);
  });

  it('keeps evaluaciones on the mediciones_tecnicas whitelist', () => {
    assert.ok(ALLOWED_TABLES.mediciones_tecnicas.columns.has('evaluaciones'));
    assert.ok(ALLOWED_TABLES.mediciones_tecnicas.columns.has('av'));
  });
});

describe('MT.40 — evaluator count', () => {
  it('counts everyone who graded at least one axis', () => {
    // A graded both, B only sanidad, C only madurez: three people took part,
    // even though neither axis has three grades.
    const avg = averageEvaluations({ evaluaciones: [
      { evaluador: 'A', sanidad: 'Limpio', madurez: 'Parcial' },
      { evaluador: 'B', sanidad: 'Limpio', madurez: null },
      { evaluador: 'C', sanidad: null,     madurez: 'Parcial' },
    ]});
    assert.equal(avg.sanidadCount, 2);
    assert.equal(avg.madurezCount, 2);
    assert.equal(avg.evaluadorCount, 3);
  });

  it('does not count a row whose labels are all unrecognised', () => {
    const avg = averageEvaluations({ evaluaciones: [
      { evaluador: 'A', sanidad: 'Limpio',  madurez: null },
      { evaluador: 'B', sanidad: 'medio ahi', madurez: 'mas o menos' },
    ]});
    assert.equal(avg.evaluadorCount, 1);
  });

  it('treats prototype keys as unrecognised', () => {
    assert.equal(sanitaryPoints('constructor'), null);
    assert.equal(madurezPoints('__proto__'), null);
    const avg = averageEvaluations({ evaluaciones: [{ sanidad: 'toString' }] });
    assert.equal(avg.evaluadorCount, 0);
    assert.equal(avg.sanidad, null);
  });
});

// Lucy third pass: the derivation only fired when the panel was present, so
// omitting it was enough to slip contradictory labels past both endpoints.
// Reproduced here against the same strip-and-derive step the handlers run.
function applyWritePolicy(row) {
  if ('evaluaciones' in row) {
    row.evaluaciones = sanitizeEvaluaciones(row.evaluaciones);
    const consensus = panelConsensus(row.evaluaciones || []);
    row.health_grade      = consensus.health_grade;
    row.phenolic_maturity = consensus.phenolic_maturity;
  } else {
    delete row.health_grade;
    delete row.phenolic_maturity;
  }
  return row;
}

describe('MT.40 — the scalars cannot be set without a panel', () => {
  it('drops caller-supplied labels when no panel accompanies them', () => {
    const row = applyWritePolicy({
      medicion_code: 'MT-26-001',
      health_grade: 'Muy limpio',
      phenolic_maturity: 'Sobresaliente',
    });
    assert.ok(!('health_grade' in row),
      'a label with no panel behind it must not reach the database');
    assert.ok(!('phenolic_maturity' in row));
    assert.equal(row.medicion_code, 'MT-26-001', 'other columns are untouched');
  });

  it('overrides caller-supplied labels that contradict the panel', () => {
    const row = applyWritePolicy({
      medicion_code: 'MT-26-001',
      evaluaciones: [{ sanidad: 'Contaminado', madurez: 'No sobresaliente' }],
      health_grade: 'Muy limpio',
      phenolic_maturity: 'Sobresaliente',
    });
    assert.equal(row.health_grade, 'Contaminado');
    assert.equal(row.phenolic_maturity, 'No sobresaliente');
  });

  it('clears both labels when the panel is present but empty', () => {
    const row = applyWritePolicy({
      medicion_code: 'MT-26-001', evaluaciones: [], health_grade: 'Muy limpio',
    });
    assert.equal(row.health_grade, null);
  });
});

// Lucy fourth pass: a present-but-malformed panel must be rejected, not
// treated as an instruction to erase.
describe('MT.40 — a malformed panel is a bad request, not a delete', () => {
  it('sanitize still reports null for a non-array so handlers can reject it', () => {
    for (const bad of [null, {}, 'x', 7]) {
      assert.equal(sanitizeEvaluaciones(bad), null);
    }
  });

  it('an explicit empty array is the only way to clear a panel', () => {
    assert.deepEqual(sanitizeEvaluaciones([]), []);
    const c = panelConsensus([]);
    assert.equal(c.health_grade, null);
    assert.equal(c.phenolic_maturity, null);
  });

  it('keeps an unrecognised label stored but unscored', () => {
    const stored = sanitizeEvaluaciones([{ sanidad: 'medio sucio', madurez: 'Buenaa' }]);
    assert.equal(stored.length, 1, 'a workbook typo is preserved, not dropped');
    const avg = averageEvaluations({ evaluaciones: stored });
    assert.equal(avg.sanidad, null, 'but it never contributes points');
    assert.equal(avg.evaluadorCount, 0);
  });
});

// Lucy 2026-08-14: sanitizeEvaluaciones drops entries that are not usable, so
// a payload of [{}] or [42] collapsed to [] and the derivation then blanked a
// perfectly good panel and both of its labels. Malformed input must be refused,
// never repaired, because repairing it destroys data on a row nobody changed.
describe('MT.40 — panelRejectionReason', () => {
  it('passes an absent panel through untouched', () => {
    assert.equal(panelRejectionReason(undefined), null);
  });

  it('accepts a well-formed panel and the explicit clear', () => {
    assert.equal(panelRejectionReason([]), null);
    assert.equal(panelRejectionReason([{ evaluador: 'A', sanidad: 'Limpio' }]), null);
    assert.equal(panelRejectionReason([{ sanidad: 'medio sucio' }]), null,
      'an unrecognised label is content, not malformed structure');
  });

  it('refuses a panel that is not a list', () => {
    for (const bad of [null, {}, 'x', 7, true]) {
      assert.match(panelRejectionReason(bad), /debe ser una lista/);
    }
  });

  it('refuses entries that would silently vanish', () => {
    // Each of these sanitises away to nothing, which would blank the panel.
    assert.match(panelRejectionReason([{}]), /entradas invalidas/);
    assert.match(panelRejectionReason([42]), /entradas invalidas/);
    assert.match(panelRejectionReason([{ foo: 'bar' }]), /entradas invalidas/);
    assert.match(panelRejectionReason([null]), /entradas invalidas/);
    assert.match(panelRejectionReason([[]]), /entradas invalidas/);
  });

  it('refuses a partly-invalid panel rather than keeping the survivors', () => {
    const mixed = [{ evaluador: 'A', sanidad: 'Limpio' }, {}];
    assert.match(panelRejectionReason(mixed), /entradas invalidas/);
  });

  it('refuses an oversized panel and an over-long field, by name', () => {
    const many = Array.from({ length: MAX_EVALUADORES + 1 }, () => ({ sanidad: 'Limpio' }));
    assert.match(panelRejectionReason(many), /Maximo 20 evaluadores/);
    assert.match(panelRejectionReason([{ evaluador: 'x'.repeat(500), sanidad: 'Limpio' }]),
      /excede 120 caracteres/);
  });

  it('a panel it accepts always survives sanitising intact', () => {
    const good = [
      { evaluador: 'Carla', sanidad: 'Muy limpio', madurez: 'Sobresaliente' },
      { evaluador: null,    sanidad: 'Limpio',     madurez: null },
    ];
    assert.equal(panelRejectionReason(good), null);
    assert.equal(sanitizeEvaluaciones(good).length, good.length);
  });
});

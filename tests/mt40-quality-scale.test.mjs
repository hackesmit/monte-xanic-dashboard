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
  MAX_EVALUADORES, sanitaryPoints, madurezPoints,
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

  it('caps the panel and does so after filtering, not before', () => {
    // Interleave junk so a cap applied before filtering would keep fewer than
    // MAX_EVALUADORES real rows.
    const input = [];
    for (let i = 0; i < MAX_EVALUADORES + 10; i++) {
      input.push(null, { evaluador: `E${i}`, sanidad: 'Limpio', madurez: null });
    }
    assert.equal(sanitizeEvaluaciones(input).length, MAX_EVALUADORES);
  });

  it('truncates long strings rather than storing them whole', () => {
    const [row] = sanitizeEvaluaciones([{ evaluador: 'x'.repeat(500), sanidad: 'Limpio' }]);
    assert.equal(row.evaluador.length, 120);
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

  it('agrees with the panel after truncation, not before it', () => {
    // 20 Contaminado then 21 Muy limpio: the caller could average all 41 and
    // claim 'Parcialmente limpio', but only the first 20 are stored, so the
    // stored panel's own consensus is Contaminado.
    const input = [];
    for (let i = 0; i < MAX_EVALUADORES; i++) input.push({ sanidad: 'Contaminado' });
    for (let i = 0; i < 21; i++) input.push({ sanidad: 'Muy limpio' });
    const stored = sanitizeEvaluaciones(input);
    assert.equal(stored.length, MAX_EVALUADORES);
    assert.equal(panelConsensus(stored).health_grade, 'Contaminado');
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

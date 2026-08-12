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

// MT.18 — Shared validation module: validateRow() and COLUMN_TYPES.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateRow, COLUMN_TYPES } from '../js/validation.js';

describe('MT.18 — validateRow', () => {
  it('accepts a valid mediciones_tecnicas update payload', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      berry_avg_weight_g: 1.92,
    });
    assert.equal(result.ok, true);
  });

  it('rejects a non-numeric value in a NUMERIC column', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      brix: 'foo',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /brix/);
    assert.match(result.error, /numérico/);
  });

  it('rejects a fractional value in an INT column', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_madura: 1.5,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /health_madura/);
    assert.match(result.error, /entero/);
  });

  it('on action: insert, requires medicion_code and other identity fields', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_date: '2026-04-29',
    }, { action: 'insert' });
    assert.equal(result.ok, false);
    assert.match(result.error, /medicion_code/);
  });

  it('on action: update (default), does NOT require non-key fields', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      // no medicion_date, vintage_year, variety, appellation
    });
    assert.equal(result.ok, true);
  });

  it('rejects an unknown table', () => {
    const result = validateRow('made_up_table', { foo: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error, /Tabla no soportada/);
  });

  it('rejects a non-integer health_quemadura (regression: was absent from intCols)', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_quemadura: 'abc',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /health_quemadura/);
  });

  it('lists health_quemadura among the mediciones_tecnicas int columns', () => {
    assert.ok(COLUMN_TYPES.mediciones_tecnicas.intCols.has('health_quemadura'));
  });

  it('rejects a negative sanitary count (xd-b0o: a negative would win the cleanest bucket)', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_picadura: -10,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /health_picadura/);
    assert.match(result.error, /no negativo/);
  });

  it('accepts a non-negative sanitary count of zero', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_picadura: 0,
    });
    assert.equal(result.ok, true);
  });

  // Parameterized over EVERY sanitary count column so the next new health_* tally
  // added to intCols but omitted from nonNegativeIntCols fails the suite loudly
  // instead of silently allowing an impossible negative through the server gate
  // (xd-b0o round 2: pasificada/aceptable/no_aceptable were left out first time).
  const SANITARY_COUNT_COLUMNS = [
    'health_madura', 'health_inmadura', 'health_sobremadura',
    'health_picadura', 'health_enfermedad', 'health_quemadura',
    'health_pasificada', 'health_aceptable', 'health_no_aceptable',
  ];

  for (const col of SANITARY_COUNT_COLUMNS) {
    it(`rejects a negative value in ${col}`, () => {
      const result = validateRow('mediciones_tecnicas', {
        medicion_code: 'MT-2025-001',
        [col]: -1,
      });
      assert.equal(result.ok, false, `${col}=-1 must be rejected`);
      assert.match(result.error, new RegExp(col));
      assert.match(result.error, /no negativo/);
    });

    it(`accepts a value of zero in ${col}`, () => {
      const result = validateRow('mediciones_tecnicas', {
        medicion_code: 'MT-2025-001',
        [col]: 0,
      });
      assert.equal(result.ok, true, `${col}=0 must be accepted`);
    });

    it(`lists ${col} in both intCols and nonNegativeIntCols`, () => {
      const spec = COLUMN_TYPES.mediciones_tecnicas;
      assert.ok(spec.intCols.has(col), `${col} missing from intCols`);
      assert.ok(spec.nonNegativeIntCols.has(col), `${col} missing from nonNegativeIntCols`);
    });
  }

  it('rejects a value just above Number.MAX_SAFE_INTEGER in a sanitary count', () => {
    // 2^53 is the first integer where Number can no longer represent every
    // successor: integer arithmetic silently loses precision from here, so a
    // count above the safe range must reject at the server gate rather than
    // reach scoreSanitaryPct as a value that produces Infinity/NaN downstream.
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_picadura: Number.MAX_SAFE_INTEGER + 1,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /health_picadura/);
    assert.match(result.error, /no negativo/);
  });

  it('exposes COLUMN_TYPES.mediciones_tecnicas with int + numeric sets', () => {
    const spec = COLUMN_TYPES.mediciones_tecnicas;
    assert.ok(spec.intCols instanceof Set);
    assert.ok(spec.numericCols instanceof Set);
    assert.ok(spec.intCols.has('vintage_year'));
    assert.ok(spec.numericCols.has('brix'));
  });
});

// tests/mt28-prediction-whites.test.mjs
// MT.28 — Modo Demo + Prediction supports the white (Brix + pH) path.
// Verifies that white-rubric groups receive phTarget, that white-specific
// reasons appear in the predictor output, and that reds are unaffected.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DemoMode } from '../js/demoMode.js';
import { DataStore } from '../js/dataLoader.js';
import * as Prediction from '../js/prediction.js';
import { CONFIG } from '../js/config.js';
import { resolveValley } from '../js/classification.js';

function runComputeAll() {
  const today = new Date();
  const currentVintage = today.getFullYear();
  const rubricFor = ({ variety, appellation }) => {
    const valley = resolveValley(appellation);
    const map = CONFIG.varietyRubricMap[valley];
    if (!map) return null;
    const rubricId = map[variety];
    return rubricId ? CONFIG.rubrics[rubricId] : null;
  };
  const valleyFor = ({ appellation }) => {
    const v = resolveValley(appellation);
    return v === 'Valle de Guadalupe' ? 'VDG'
         : v === 'Valle de Ojos Negros' ? 'VON'
         : v === 'Valle de San Vicente' ? 'VSV' : null;
  };
  return Prediction.computeAll({
    berryData: DataStore.berryData || [],
    today, currentVintage,
    overrides: DataStore.harvestTargetOverrides || [],
    rubricFor, valleyFor,
  });
}

test('MT.28 whites: every white group has phTarget set, antTarget null', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    assert.ok(whites.length >= 1, `no white groups in demo (found: ${results.map(r=>r.variety).join(',')})`);
    for (const r of whites) {
      assert.ok(r.target.phTarget != null,
        `${r.variety} ${r.appellation}: phTarget should be non-null`);
      assert.equal(r.target.antTarget, null,
        `${r.variety} ${r.appellation}: antTarget should be null for whites`);
    }
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: every red group has antTarget set, phTarget null', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const reds = results.filter(r => !whiteVarieties.has(r.variety));
    assert.ok(reds.length >= 1, 'no red groups in demo');
    for (const r of reds) {
      assert.ok(r.target.antTarget != null,
        `${r.variety} ${r.appellation}: antTarget should be non-null for reds`);
      assert.equal(r.target.phTarget, null,
        `${r.variety} ${r.appellation}: phTarget should be null for reds`);
    }
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: at least one ph-temprano OR riesgo-ph OR ph-excedido card', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    const phReasons = whites.map(r => r.prediction.reason).filter(rsn =>
      rsn === 'ph-temprano' || rsn === 'riesgo-ph' || rsn === 'ph-excedido');
    assert.ok(phReasons.length >= 1,
      `no white pH-reason cards. White reasons: ${whites.map(r => r.prediction.reason).join(',')}`);
  } finally {
    DemoMode.disable();
  }
});

test('MT.28 whites: phHoy is populated for white groups', () => {
  DemoMode.enable();
  try {
    const results = runComputeAll();
    const whiteVarieties = new Set([
      'Sauvignon Blanc', 'Chardonnay', 'Chenin Blanc', 'Viognier',
    ]);
    const whites = results.filter(r => whiteVarieties.has(r.variety));
    for (const r of whites) {
      const p = r.prediction;
      if (p.reason === 'pocos-datos-temporada') continue;
      assert.ok(Number.isFinite(p.phHoy),
        `${r.variety} ${r.appellation}: phHoy=${p.phHoy} should be finite`);
    }
  } finally {
    DemoMode.disable();
  }
});

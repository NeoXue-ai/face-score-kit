// Display-mapping unit tests (rules doc v3 §2): monotonicity, clamps, and
// the calibration anchor points the constants were fitted to.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DIMENSION_SCALE,
  DISPLAY_SCALE,
  toDisplay10,
  toDisplay10Dimension,
} from './score-display';
import { DIMENSION_WEIGHTS, type Dimension } from './score-rules';

const DIMS = Object.keys(DIMENSION_WEIGHTS) as Dimension[];

test('monotone non-decreasing in the raw score', () => {
  let prev = -1;
  for (let raw = 0; raw <= 100; raw += 0.5) {
    const v = toDisplay10(raw);
    assert.ok(v >= prev, `regression at raw ${raw}: ${v} < ${prev}`);
    prev = v;
  }
  // strictly increasing across the unclamped middle band
  assert.ok(toDisplay10(90) < toDisplay10(92));
});

test('clamped to [0.5, 9.8] at both ends', () => {
  assert.equal(toDisplay10(0), 0.5);
  assert.equal(toDisplay10(100), 9.8);
  assert.equal(toDisplay10(120), 9.8);
  assert.equal(toDisplay10(-5), 0.5);
});

test('calibration anchors: real-reference median maps to 5.8, p95 raw to 8.0', () => {
  assert.equal(toDisplay10(DISPLAY_SCALE.refMedianRaw), 5.8);
  // raw p95 of the calibrated synthetic population (calibrate-score-dist.ts)
  assert.ok(Math.abs(toDisplay10(95.37) - 8.0) <= 0.05);
});

test('output is one decimal and finite-or-NaN', () => {
  for (const raw of [0, 33.3, 61.7, 75, 89.3, 97.2, 100]) {
    const v = toDisplay10(raw);
    assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, `${raw} -> ${v}`);
  }
  assert.ok(Number.isNaN(toDisplay10(Number.NaN)));
  assert.ok(Number.isNaN(toDisplay10(Number.POSITIVE_INFINITY)));
});

test('dimension maps: own median anchors at 5.8, one decimal, clamped', () => {
  for (const d of DIMS) {
    const s = DIMENSION_SCALE[d];
    assert.equal(toDisplay10Dimension(d, s.medianRaw), 5.8, d);
    assert.equal(toDisplay10Dimension(d, 1000), 9.8, d);
    assert.equal(toDisplay10Dimension(d, -1000), 0.5, d);
    assert.ok(toDisplay10Dimension(d, s.medianRaw - 5) < 5.8, d);
    assert.ok(toDisplay10Dimension(d, s.medianRaw + 5) > 5.8, d);
    const v = toDisplay10Dimension(d, 83.3);
    assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, `${d} ${v}`);
  }
  // The dimension fit must resolve below the composite floor instead of
  // clamping there: the proportion dimension map resolves above raw ≈77.0
  // while the composite map stays floored until raw ≈81.7 — pick 79, inside
  // that window.
  assert.ok(toDisplay10Dimension('proportion', 79) > toDisplay10(79));
});

// Display-scale mapping (rules doc v3 §2): the engine keeps working on the
// internal 0..100 raw scale; users see a normal-calibrated 0..10 score.
// A/B are solved by scripts/calibrate-score-dist.ts: a deterministic Monte
// Carlo over a synthetic population whose per-rule spread is K curve-sigmas,
// with K binary-searched so the population median raw total equals the
// measured raw total of a real ordinary-face reference photo pair (89.3) —
// i.e. an ordinary face IS the population median. The displayed total is
// then ~normal with median 5.8 and P95 = 8.0, "most people sit in 5..7".
// Dimensions carry their own fits of the same convention (median -> 5.8,
// P95 -> 8.0): a composite-fitted slope is too steep for single dimensions
// (the real-reference probe clamped the proportion bar to the floor while
// the composite read 5.8). This is a scoring convention fitted to a
// SYNTHETIC population anchored on one real reference pair, not a measured
// human percentile. Recompute and bump SCORING_VERSION whenever these
// constants change.

import type { Dimension } from './score-rules';

export const DISPLAY_SCALE = {
  seed: 20260924,
  faces: 20000,
  sigmaK: 0.443,
  refMedianRaw: 91.36,
  a: -44.3573,
  b: 0.549,
  min: 0.5,
  max: 9.8,
} as const;

// From the same MC run (scripts/calibrate-score-dist.ts, perDimension).
export const DIMENSION_SCALE: Record<
  Dimension,
  { medianRaw: number; a: number; b: number }
> = {
  proportion: { medianRaw: 92.88, a: -25.1518, b: 0.3332 },
  balance: { medianRaw: 92.22, a: -30.1448, b: 0.3898 },
  eyes: { medianRaw: 92.71, a: -27.4538, b: 0.3587 },
  nose: { medianRaw: 93.47, a: -28.2731, b: 0.3645 },
  mouth: { medianRaw: 93.37, a: -27.7861, b: 0.3597 },
  lower: { medianRaw: 92.8, a: -27.7166, b: 0.3612 },
};

function mapRound(a: number, b: number, raw: number): number {
  if (!Number.isFinite(raw)) return Number.NaN;
  const v = a + b * raw;
  const clamped = Math.min(DISPLAY_SCALE.max, Math.max(DISPLAY_SCALE.min, v));
  return Math.round(clamped * 10) / 10;
}

/** rawTotal (0..100) -> composite display score, one decimal, clamped. */
export function toDisplay10(raw: number): number {
  return mapRound(DISPLAY_SCALE.a, DISPLAY_SCALE.b, raw);
}

/** dimensionRaw (0..100) -> per-dimension display score, same 0..10 scale. */
export function toDisplay10Dimension(dim: Dimension, raw: number): number {
  const s = DIMENSION_SCALE[dim];
  return mapRound(s.a, s.b, raw);
}

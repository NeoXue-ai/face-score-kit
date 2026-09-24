import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  band,
  deviation,
  SCORE_RULES,
  scorePhoto,
  validateRuleTable,
} from './score-rules';
import {
  baseFace,
  mirrorFace,
  rotateFace,
  scaleFace,
  withPoint,
} from './test-fixtures';

const scored = (
  pts: Parameters<typeof scorePhoto>[1],
  bounds?: { width: number; height: number }
) => {
  const r = scorePhoto('fixture', pts, bounds);
  if (r.status !== 'scored')
    throw new Error(`expected scored, got ${r.status}:${r.detail ?? r.reason}`);
  return r.score;
};
const contrib = (s: ReturnType<typeof scored>, ruleId: string) =>
  s.contributions.find((c) => c.ruleId === ruleId)!;
const statuses = (s: ReturnType<typeof scored>) =>
  s.contributions.map((c) => `${c.ruleId}:${c.status}`).join(',');
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// --- rule table contract ----------------------------------------------------

test('rule table matches the frozen contract', () => {
  assert.deepEqual(validateRuleTable(), []);
  assert.equal(SCORE_RULES.length, 17);
});

// --- scoring functions ------------------------------------------------------

test('band: gaussian falloff, center 100, continuity, guards', () => {
  // center of [0.75, 1.5] is 1.125 — the only point that scores 100 now.
  assert.equal(band(1.125, 0.75, 1.5, 0.35, 2.0), 100);
  // the old zero edges sit at 2.5σ → 100·e^(−3.125) ≈ 4.39 (never a hard 0)
  assert.ok(close(band(0.35, 0.75, 1.5, 0.35, 2.0), 100 * Math.exp(-3.125)));
  assert.ok(close(band(2.0, 0.75, 1.5, 0.35, 2.0), 100 * Math.exp(-3.125)));
  // far outside: exponentially small but positive
  assert.ok(band(2.5, 0.75, 1.5, 0.35, 2.0) > 0);
  assert.ok(band(2.5, 0.75, 1.5, 0.35, 2.0) < 0.05); // z ≈ 3.93 → ~0.045
  // monotone away from the center on both sides
  assert.ok(band(0.9, 0.75, 1.5, 0.35, 2.0) < band(1.0, 0.75, 1.5, 0.35, 2.0));
  assert.ok(band(1.4, 0.75, 1.5, 0.35, 2.0) > band(1.6, 0.75, 1.5, 0.35, 2.0));
  // continuous at the center despite the asymmetric widths
  const eps = 1e-12;
  assert.ok(Math.abs(band(1.125 - eps, 0.75, 1.5, 0.35, 2.0) - 100) < 1e-6);
  assert.ok(Math.abs(band(1.125 + eps, 0.75, 1.5, 0.35, 2.0) - 100) < 1e-6);
  assert.ok(Number.isNaN(band(Number.NaN, 0.75, 1.5, 0.35, 2.0)));
  assert.ok(Number.isNaN(band(Infinity, 0.75, 1.5, 0.35, 2.0)));
});

test('deviation: falloff from 0, guards', () => {
  assert.equal(deviation(0, 0.03, 0.2), 100);
  // old plateau edge is no longer free: z = 0.03/(0.2/2.5) = 0.375
  assert.ok(
    close(deviation(0.03, 0.03, 0.2), 100 * Math.exp(-0.5 * 0.375 ** 2))
  );
  assert.ok(close(deviation(0.2, 0.03, 0.2), 100 * Math.exp(-3.125)));
  assert.ok(deviation(0.5, 0.03, 0.2) > 0); // asymptotic, never a hard 0
  assert.ok(deviation(0.5, 0.03, 0.2) < 1e-6);
  assert.ok(Number.isNaN(deviation(-0.01, 0.03, 0.2)));
  assert.ok(Number.isNaN(deviation(Number.NaN, 0.03, 0.2)));
});

// --- per-rule expected values on the synthetic fixture ----------------------

test('base fixture: all 17 rules included, raw total in the high 80s', () => {
  // The fixture is a competent-but-not-perfect face: its ratios sit slightly
  // off the curve centers, so the continuous curves score it ~88.0, not 100.
  // Exactness is pinned by the determinism test; per-rule values are pinned
  // by 'metric values match hand-computed ratios' + the curve unit tests.
  const s = scored(baseFace());
  assert.equal(s.validRuleIds.length, 17);
  assert.ok(close(s.rawTotal, 87.95163086484699));
  for (const dim of [
    'proportion',
    'balance',
    'eyes',
    'nose',
    'mouth',
    'lower',
  ] as const) {
    assert.ok(close(s.dimensionEffectiveWeight[dim], 1), `weight ${dim}`);
    assert.ok(
      s.dimensionRaw[dim] > 60 && s.dimensionRaw[dim] <= 100,
      `dim ${dim}`
    );
  }
});

test('metric values match hand-computed ratios', () => {
  const s = scored(baseFace());
  // frame: W = dist(234,454) = 160, H = 220, eye line y = 160
  assert.ok(Math.abs(contrib(s, 'L1').metricValue! - 40 / 38) < 1e-9); // intercanthal / eye width
  assert.ok(Math.abs(contrib(s, 'L2').metricValue! - 80 / 220) < 1e-9); // forehead / face height
  assert.ok(Math.abs(contrib(s, 'L3').metricValue! - 60 / 160) < 1e-9); // mouth width / W
  assert.ok(Math.abs(contrib(s, 'C1').metricValue! - 220 / 160) < 1e-9); // H / W
  assert.ok(Math.abs(contrib(s, 'C2').metricValue! - 90 / 160) < 1e-9); // temple width / W
  assert.ok(Math.abs(contrib(s, 'C3').metricValue! - 110 / 160) < 1e-9); // jaw width / W
  assert.ok(Math.abs(contrib(s, 'E2').metricValue! - 38 / 160) < 1e-9); // eye width / W
  assert.ok(Math.abs(contrib(s, 'E3').metricValue! - 13 / 38) < 1e-9); // lid height / eye width
  assert.ok(Math.abs(contrib(s, 'N1').metricValue! - 40 / 40) < 1e-9); // alar width / intercanthal (v2.1 pairing)
  assert.ok(Math.abs(contrib(s, 'N2').metricValue! - 57 / 125) < 1e-9); // nose length / midface
  assert.ok(Math.abs(contrib(s, 'M2').metricValue! - 8 / 6) < 1e-9); // lower / upper lip
  assert.ok(Math.abs(contrib(s, 'J2').metricValue! - 62 / 220) < 1e-9); // lower face / face height
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5'])
    assert.equal(contrib(s, id).metricValue, 0);
});

test('decay is continuous: perturbing a ratio off-band lowers score smoothly', () => {
  // widen the mouth beyond L3's fullHi (0.55 * W = 88 px): corners at ±46 from centre
  const wide = withPoint(
    withPoint(baseFace(), 61, [154, 240]),
    291,
    [246, 240]
  );
  const s = scored(wide);
  const c = contrib(s, 'L3');
  assert.equal(c.status, 'included');
  assert.ok(Math.abs(c.metricValue! - 92 / 160) < 1e-9); // 0.575
  // gaussian falloff from the band center 0.40 with s_hi = (0.7−0.4)/2.5 = 0.12
  assert.ok(
    close(c.rawScore!, 100 * Math.exp(-0.5 * ((0.575 - 0.4) / 0.12) ** 2))
  );
  assert.ok(c.rawScore! < 100 && c.rawScore! > 20); // smooth, not a cliff
  assert.ok(s.rawTotal < 88 && s.rawTotal > 80); // base fixture is ~88.0
});

// --- invariances required by the acceptance gates ---------------------------

test('scale invariance: 0.5× and 3× reproduce identical scores', () => {
  const base = scored(baseFace());
  for (const k of [0.5, 3]) {
    const s = scored(scaleFace(baseFace(), k));
    assert.equal(statuses(s), statuses(base));
    assert.ok(close(s.rawTotal, base.rawTotal), `rawTotal ${k}×`);
  }
});

test('mirror invariance: horizontal mirror reproduces identical scores', () => {
  const base = scored(baseFace());
  const s = scored(mirrorFace(baseFace()));
  assert.equal(statuses(s), statuses(base));
  assert.ok(close(s.rawTotal, base.rawTotal));
  for (const dim of [
    'proportion',
    'balance',
    'eyes',
    'nose',
    'mouth',
    'lower',
  ] as const)
    assert.ok(close(s.dimensionRaw[dim], base.dimensionRaw[dim]), `dim ${dim}`);
});

test('rotation invariance: camera roll up to ±25° is compensated', () => {
  const base = scored(baseFace());
  for (const deg of [-25, -7.5, 12, 25]) {
    const s = scored(rotateFace(baseFace(), deg));
    assert.ok(Math.abs(s.rawTotal - base.rawTotal) < 1e-9, `roll ${deg}`);
  }
});

// --- exclusions and coverage gates ------------------------------------------

test('asymmetric eye shifts the balance metrics without breaking coverage', () => {
  // raise the whole right eye 6 px: centres differ vertically by 6/W = 0.0375
  const pts = withPoint(
    withPoint(baseFace(), 362, [220, 154]),
    263,
    [258, 154]
  );
  const s = scored(pts);
  const s2 = contrib(s, 'S2');
  assert.equal(s2.status, 'included');
  assert.ok(close(s2.metricValue!, 6 / 160));
  // gaussian: s = zeroAt/2.5 = 0.024, z = 0.0375/0.024 = 1.5625
  assert.ok(
    close(s2.rawScore!, 100 * Math.exp(-0.5 * (6 / 160 / (0.06 / 2.5)) ** 2))
  );
  assert.ok(s2.rawScore! < 100);
  assert.equal(s.rawTotal < 100, true);
});

test('non-finite forehead point excludes its rules and fails the gates', () => {
  const broken = baseFace();
  broken[10] = [NaN, NaN];
  const s = scorePhoto('f', broken);
  // losing 10 excludes L2, S4, S5, C1, J2 → proportion drops to 0 rules and
  // balance keeps only S1..S3 (0.65 < 0.70)
  assert.equal(s.status, 'unscorable');
  if (s.status === 'unscorable' && s.reason === 'insufficient_metrics') {
    assert.match(s.detail ?? '', /balance:weight<0\.7/);
    assert.match(s.detail ?? '', /proportion:rules<2/);
    assert.match(s.detail ?? '', /total<0\.8/);
    const ex = s.contributions
      .filter((c) => c.status === 'excluded')
      .map((c) => c.ruleId);
    assert.deepEqual(ex.sort(), ['C1', 'J2', 'L2', 'S4', 'S5']);
  } else {
    assert.fail(`unexpected ${s.reason}`);
  }
});

test('losing one of three lower-face rules fails the 0.65 gate', () => {
  // C3 (.4) out → lower keeps C2 (.3) + J2 (.3) = 0.6 < 0.65
  const broken = baseFace();
  broken[172] = [Number.NaN, 0];
  const r = scorePhoto('f', broken);
  assert.equal(r.status, 'unscorable');
  if (r.status === 'unscorable') {
    assert.equal(r.reason, 'insufficient_metrics');
    assert.match(r.detail ?? '', /lower:weight<0\.65/);
  }
});

test('losing E3 keeps the eyes dimension alive at exactly 0.65', () => {
  // collapse the right lid height → E3 excluded, L1 + E2 = 0.65 ≥ 0.65
  const broken = baseFace();
  broken[386] = [239, 163]; // same point as 374 → dist = 0
  const s = scored(broken);
  assert.equal(contrib(s, 'E3').status, 'excluded');
  assert.equal(contrib(s, 'E3').excludedReason, 'lid_height_zero');
  assert.equal(s.validRuleIds.length, 16);
});

test('a two-rule dimension cannot survive a single-rule loss (≥2 gate)', () => {
  // 168 = 152 → N2's midface denominator is zero → nose has 1 rule left
  const broken = baseFace();
  broken[168] = [200, 300];
  const r = scorePhoto('f', broken);
  assert.equal(r.status, 'unscorable');
  if (r.status === 'unscorable' && r.reason === 'insufficient_metrics') {
    assert.match(r.detail ?? '', /nose:rules<2/);
    const n2 = r.contributions.find((c) => c.ruleId === 'N2')!;
    assert.equal(n2.excludedReason, 'midface_zero');
  } else {
    assert.fail(`unexpected ${r.reason}`);
  }
});

test('iris points are frame-critical (model_failed, never a silent partial score)', () => {
  const broken = baseFace();
  broken[468] = [0, Number.NaN];
  const r = scorePhoto('f', broken);
  assert.equal(r.status, 'unscorable');
  if (r.status === 'unscorable') {
    assert.equal(r.reason, 'model_failed');
    assert.match(r.detail ?? '', /iris/);
  }
});

test('out-of-frame landmarks exclude their rules when bounds are provided', () => {
  const pts = withPoint(baseFace(), 67, [450, 120]); // beyond width 400
  const s = scored(pts, { width: 400, height: 400 }); // C2 excluded → lower 0.7 ≥ 0.65
  assert.equal(contrib(s, 'C2').status, 'excluded');
  assert.equal(
    contrib(s, 'C2').excludedReason,
    'landmark_missing_or_out_of_frame'
  );
  assert.equal(s.validRuleIds.length, 16);
});

test('forehead point below the eye line: L2 excluded and proportion gate fails', () => {
  // L2 refuses the measurement (excluded, never a fabricated 0), which drops
  // proportion to a single rule → the ≥2 gate rejects before any score is read.
  const pts = withPoint(baseFace(), 10, [200, 170]); // below eye line y=160
  const r = scorePhoto('f', pts);
  assert.equal(r.status, 'unscorable');
  if (r.status === 'unscorable' && r.reason === 'insufficient_metrics') {
    assert.match(r.detail ?? '', /proportion:rules<2/);
    const l2 = r.contributions.find((c) => c.ruleId === 'L2')!;
    assert.equal(l2.excludedReason, 'forehead_landmark_invalid');
    // C1 still measures on the collapsed face: included, and the ratio is so
    // far off the center that the gaussian curve leaves it asymptotically ~0
    const c1 = r.contributions.find((c) => c.ruleId === 'C1')!;
    assert.equal(c1.status, 'included');
    assert.ok(c1.rawScore! < 1);
  } else {
    assert.fail(`unexpected ${r.reason}`);
  }
});

// --- determinism -------------------------------------------------------------

test('determinism: 100 runs reproduce byte-identical scores', () => {
  const first = JSON.stringify(scored(baseFace()));
  for (let i = 0; i < 99; i++)
    assert.equal(JSON.stringify(scored(baseFace())), first);
});

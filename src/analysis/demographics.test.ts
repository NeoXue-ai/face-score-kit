import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEMOGRAPHICS_THRESHOLDS,
  ageToBand,
  decodeGenderAge,
  gradePrediction,
} from './demographics';

// Raw-output values observed from the real model (probe 2026-09-24, adult
// male reference photo): [0.2221, -0.222, 0.3513] -> male, 35y.
const REAL_MALE = [0.2221, -0.222, 0.3513];

describe('decodeGenderAge', () => {
  it('decodes the real probe output to male / 35y', () => {
    const p = decodeGenderAge(REAL_MALE);
    assert.equal(p.gender, 'male');
    assert.equal(p.ageYears, 35);
    assert.ok(Math.abs(p.genderMargin - 0.222) < 0.001);
  });
  it('decodes female when pred[1] > pred[0]', () => {
    const p = decodeGenderAge([-0.3, 0.3, 0.4]);
    assert.equal(p.gender, 'female');
    assert.equal(p.ageYears, 40);
    assert.ok(Math.abs(p.genderMargin - 0.3) < 1e-9);
  });
  it('ties go to male (argmax with >=)', () => {
    const p = decodeGenderAge([0.1, 0.1, 0.3]);
    assert.equal(p.gender, 'male');
    assert.equal(p.genderMargin, 0);
  });
  it('throws on non-finite values', () => {
    assert.throws(() => decodeGenderAge([NaN, 0, 0.3]));
    assert.throws(() => decodeGenderAge([Infinity, 0, 0.3]));
    assert.throws(() => decodeGenderAge([0.1]));
  });
});

describe('ageToBand', () => {
  it('maps band edges consistently', () => {
    assert.equal(ageToBand(5), '<20');
    assert.equal(ageToBand(19), '<20');
    assert.equal(ageToBand(20), '20-35');
    assert.equal(ageToBand(34), '20-35');
    assert.equal(ageToBand(35), '35-50');
    assert.equal(ageToBand(49), '35-50');
    assert.equal(ageToBand(50), '50+');
    assert.equal(ageToBand(88), '50+');
  });
});

describe('gradePrediction', () => {
  it('accepts the real probe output', () => {
    const g = gradePrediction(decodeGenderAge(REAL_MALE));
    assert.equal(g.status, 'estimated');
    assert.deepEqual(g.reasons, []);
  });
  it('flags a low-margin gender as uncertain', () => {
    const g = gradePrediction(decodeGenderAge([0.01, -0.01, 0.3]));
    assert.equal(g.status, 'uncertain');
    assert.ok(g.reasons.includes('gender_low_margin'));
  });
  it('flags implausible ages as uncertain', () => {
    const g = gradePrediction(decodeGenderAge([0.4, -0.4, 0.005]));
    assert.equal(g.status, 'uncertain');
    assert.ok(g.reasons.includes('age_implausible'));
    const g2 = gradePrediction(decodeGenderAge([0.4, -0.4, 0.999]));
    assert.equal(g2.status, 'uncertain');
    assert.ok(g2.reasons.includes('age_implausible'));
  });
  it('keeps thresholds ordered and inside the observed output range', () => {
    const t = DEMOGRAPHICS_THRESHOLDS;
    assert.ok(t.genderMarginMin > 0 && t.genderMarginMin < 0.2);
    assert.ok(t.ageMin < t.ageMax);
  });
});

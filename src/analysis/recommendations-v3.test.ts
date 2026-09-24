// V3 recommendation gate tests (eng spec §7): the card engine is evidence-
// gated — only included, 'pass'-reliable rules below the trigger band on the
// single scored photo produce advice, sorted worst-first and capped.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  v3MetricKey,
  v3RuleEvidenceId,
  type PerPhotoRuleScoreV3,
  type RuleContributionV3,
  type RuleMetric,
  type ScoreOutcomeV3,
} from '../analysis-schema';
import { buildRecommendationsV3, REC_TRIGGER_MAX } from './recommendations-v3';
import {
  DIMENSION_WEIGHTS,
  SCORING_VERSION,
  type Dimension,
} from './score-rules';

const DIMS = Object.keys(DIMENSION_WEIGHTS) as Dimension[];
const allDims = (v: number): Record<Dimension, number> =>
  DIMS.reduce(
    (acc, d) => ({ ...acc, [d]: v }),
    {} as Record<Dimension, number>
  );

function included(
  ruleId: string,
  dimension: Dimension,
  metricId: string,
  rawScore: number
): RuleContributionV3 {
  return {
    status: 'included',
    ruleId,
    dimension,
    metricId,
    metricValue: 0.5,
    rawScore,
    effectiveWeight: 0.1,
    evidenceId: v3RuleEvidenceId('front', ruleId),
  };
}

function photo(contributions: RuleContributionV3[]): PerPhotoRuleScoreV3 {
  return {
    photoId: 'front',
    rawTotal: 80,
    dimensionRaw: allDims(80),
    dimensionEffectiveWeight: allDims(1),
    contributions,
    validRuleIds: contributions.map((c) => c.ruleId),
  };
}

function outcome(p: PerPhotoRuleScoreV3): ScoreOutcomeV3 {
  return {
    status: 'scored',
    scoringVersion: SCORING_VERSION,
    compositeScore: 8,
    rawComposite: 80,
    dimensionDisplay: allDims(80),
    perPhoto: [p],
  };
}

function passMetrics(p: PerPhotoRuleScoreV3): Record<string, RuleMetric> {
  const metrics: Record<string, RuleMetric> = {};
  for (const c of p.contributions)
    if (c.status === 'included')
      metrics[v3MetricKey(p.photoId, c.metricId)] = {
        metricId: c.metricId,
        value: 0.5,
        unit: 'ratio',
        reliability: 'pass',
        evidenceId: c.evidenceId,
        landmarkIds: [],
      };
  return metrics;
}

test('a rule triggering on the pass-reliable photo gets a card', () => {
  const p = photo([included('S1', 'balance', 'eye_width_asymmetry', 20)]);
  const cards = buildRecommendationsV3(outcome(p), passMetrics(p));
  assert.equal(cards.length, 1);
  const card = cards[0]!;
  assert.equal(card.observedFeature, 'rec.s1.observed');
  assert.equal(card.goal, 'rec.balance.goal');
  assert.equal(card.action, 'rec.s1.action');
  assert.equal(card.rationale, 'rec.rationale');
  assert.equal(card.conditions, 'rec.conditions');
  assert.deepEqual(card.evidenceIds, [v3RuleEvidenceId('front', 'S1')]);
});

test('excluded contributions never produce a card', () => {
  const p = photo([
    {
      status: 'excluded',
      ruleId: 'L1',
      dimension: 'eyes',
      metricId: 'r',
      excludedReason: 'invalid_input',
      effectiveWeight: 0,
    },
  ]);
  assert.deepEqual(buildRecommendationsV3(outcome(p), passMetrics(p)), []);
});

test('warn reliability blocks the evidence gate', () => {
  const p = photo([
    included('C1', 'proportion', 'face_height_width_ratio', 25),
  ]);
  const metrics = passMetrics(p);
  metrics[v3MetricKey('front', 'face_height_width_ratio')]!.reliability =
    'warn';
  assert.deepEqual(buildRecommendationsV3(outcome(p), metrics), []);
});

test('at or above the trigger band is not a finding', () => {
  const p = photo([included('C1', 'proportion', 'm', REC_TRIGGER_MAX)]);
  assert.deepEqual(buildRecommendationsV3(outcome(p), passMetrics(p)), []);
});

test('cards sort by raw score, tie-break ruleId, capped at 3', () => {
  const rules: [string, Dimension, string, number][] = [
    ['S5', 'balance', 'm5', 50],
    ['S1', 'balance', 'm1', 20],
    ['S2', 'balance', 'm2', 30],
    ['S3', 'balance', 'm3', 30],
    ['S4', 'balance', 'm4', 10],
  ];
  const p = photo(
    rules.map(([id, dim, metric, raw]) => included(id, dim, metric, raw))
  );
  const cards = buildRecommendationsV3(outcome(p), passMetrics(p));
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.observedFeature),
    ['rec.s4.observed', 'rec.s1.observed', 'rec.s2.observed']
  );
});

test('a new-dimension rule (E2) recommends with its own dimension goal', () => {
  const p = photo([included('E2', 'eyes', 'eye_width_over_face_width', 25)]);
  const cards = buildRecommendationsV3(outcome(p), passMetrics(p));
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.observedFeature, 'rec.e2.observed');
  assert.equal(cards[0]!.goal, 'rec.eyes.goal');
});

test('no_score outcomes never recommend', () => {
  const cards = buildRecommendationsV3(
    { status: 'no_score', reason: 'quality_failed' } as ScoreOutcomeV3,
    {}
  );
  assert.deepEqual(cards, []);
});

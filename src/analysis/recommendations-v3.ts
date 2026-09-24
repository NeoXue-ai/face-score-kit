// V3 recommendation rules (eng spec §7). Quality gates are admission only, so
// a card's evidence is purely geometric: a rule must have scored on the photo,
// at reliability 'pass', and its raw score must fall below the trigger band.
// Cards carry reversible styling / shooting advice — never a promised score
// change — and no score/number is embedded in the card text.

import {
  v3MetricKey,
  type RecommendationCard,
  type RuleMetric,
  type ScoreOutcomeV3,
} from '../analysis-schema';
import type { Dimension } from './score-rules';

// v3 continuous curves put an average rule at raw ≈91 (anchored so an
// ordinary real face is the population median), so a below-100 trigger would
// flag half of everyone's rules. 81 ≈ the 15th percentile of the
// synthetic-population rule-score distribution (scripts/calibrate-score-dist.ts,
// sigmaK 0.443): only genuine outliers on that metric produce a card.
export const REC_TRIGGER_MAX = 81;
export const REC_MAX_CARDS = 3;

interface RuleDraft {
  ruleId: string;
  dimension: Dimension;
  rawScore: number;
  evidenceIds: string[];
}

export function buildRecommendationsV3(
  score: ScoreOutcomeV3,
  metrics: Record<string, RuleMetric>
): RecommendationCard[] {
  if (score.status !== 'scored') return [];

  const drafts = new Map<string, RuleDraft>();
  for (const photo of score.perPhoto) {
    for (const c of photo.contributions) {
      if (c.status !== 'included') continue;
      // Evidence gate: the metric behind this contribution must be 'pass'
      // quality on this photo (spec §7 — evidence must exist AND be reliable).
      const metric = metrics[v3MetricKey(photo.photoId, c.metricId)];
      if (!metric || metric.reliability !== 'pass') continue;
      drafts.set(c.ruleId, {
        ruleId: c.ruleId,
        dimension: c.dimension,
        rawScore: c.rawScore,
        evidenceIds: [c.evidenceId],
      });
    }
  }

  return Array.from(drafts.values())
    .filter((d) => d.rawScore < REC_TRIGGER_MAX)
    .sort((a, b) => a.rawScore - b.rawScore || a.ruleId.localeCompare(b.ruleId))
    .slice(0, REC_MAX_CARDS)
    .map((d): RecommendationCard => {
      const key = d.ruleId.toLowerCase();
      return {
        observedFeature: `rec.${key}.observed`,
        goal: `rec.${d.dimension}.goal`,
        action: `rec.${key}.action`,
        rationale: 'rec.rationale',
        conditions: 'rec.conditions',
        evidenceIds: d.evidenceIds,
      };
    });
}

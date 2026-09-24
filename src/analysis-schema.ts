// Analysis data model — single source of truth for the report.
// V3 (current): pure-local rule score ("规则审美参考分") from score-rules.ts,
// single-photo input (local-rules-3.1.0), strict unions so a no-score outcome
// can never carry a composite. Contract: docs/rules/scoring-rules-v3.md +
// eng spec §6.

import type { FaceShapeLabel } from './analysis/face-shape';
import { toDisplay10, toDisplay10Dimension } from './analysis/score-display';
import {
  DIMENSION_WEIGHTS,
  LANDMARK_MODEL_VERSION,
  QUALITY_VERSION,
  SCORE_RULES,
  SCORING_VERSION,
  type Dimension,
  type PhotoScore,
  type RuleContribution,
} from './analysis/score-rules';
import { SKIN_VERSION, type SkinAnalysis } from './analysis/skin';
import {
  DEMOGRAPHICS_VERSION,
  MODEL_ID as DEMOGRAPHICS_MODEL_ID,
  type AgeBand,
  type DemographicsAnalysis,
} from './analysis/demographics';

export type SkinQualityV3 = SkinAnalysis;
export type DemographicsV3 = DemographicsAnalysis;

/** Honest no-score outcomes. Admission quality only — never a low score. */
export type NoScoreReason =
  | 'quality_failed'
  | 'insufficient_metrics'
  | 'model_failed'
  | 'unsupported_browser';

export type Grade = 'pass' | 'warn' | 'fail';

export type QualityReasonKey =
  | 'no_face'
  | 'multiple_faces'
  | 'blur'
  | 'overexposed'
  | 'underexposed'
  | 'pose_yaw'
  | 'pose_pitch'
  | 'pose_roll'
  | 'occlusion'
  | 'low_resolution'
  | 'filter_suspected'
  // quality-1.3.0 blendshape-driven soft grades
  | 'expression_exaggerated'
  | 'expression_smile'
  | 'expression_brow';

export type Reliability = Grade;

// ---------------------------------------------------------------------------
// Layer A — per-photo quality gate verdict
// ---------------------------------------------------------------------------

export interface QualityChecks {
  faceCount: 0 | 1 | 'multiple';
  pose: Grade;
  blur: Grade;
  exposure: Grade;
  occlusion: Grade;
  expression?: Grade;
  filterSigns?: Grade;
}

export interface QualityVerdict {
  pass: boolean;
  checks: QualityChecks;
  reasons: QualityReasonKey[];
}

// ---------------------------------------------------------------------------
// Layer D — recommendations (every card must trace to evidence)
// ---------------------------------------------------------------------------

export interface RecommendationCard {
  observedFeature: string;
  goal: string;
  action: string;
  rationale: string;
  conditions: string;
  evidenceIds: string[];
  reviewedBy?: 'stylist' | 'user_trial';
}

// ---------------------------------------------------------------------------
// Evidence dictionary — every displayed number/claim resolves here
// ---------------------------------------------------------------------------

export type Evidence =
  | { kind: 'measurement'; source: string; reliability: Reliability }
  | { kind: 'model_output'; provider: string; modelVersion: string }
  | { kind: 'quality'; check: keyof QualityChecks; grade: Grade }
  | { kind: 'rule'; ruleId: string };

/** A recommendation card without resolvable evidence must not render (FR-05). */
export function isRenderableRecommendation(
  card: RecommendationCard,
  evidence: Record<string, Evidence>
): boolean {
  return (
    card.evidenceIds.length > 0 &&
    card.evidenceIds.every((id) => id in evidence)
  );
}

// ---------------------------------------------------------------------------
// AnalysisV3 — pure-local rule score report (PRD v1.1 / eng spec §6)
// ---------------------------------------------------------------------------

export const ANALYSIS_V3_VERSION = 3 as const;

export type PhotoRoleV3 = 'front';

/** Metric reliability shown to users; derived from the photo's quality verdict. */
export type ReliabilityV3 = 'pass' | 'warn';

export interface RuleMetric {
  metricId: string;
  value: number;
  unit: 'ratio';
  reliability: ReliabilityV3;
  evidenceId: string;
  landmarkIds: number[];
}

/** Strict union: an included contribution always carries its value + score. */
export type RuleContributionV3 =
  | {
      status: 'included';
      ruleId: string;
      dimension: Dimension;
      metricId: string;
      metricValue: number;
      rawScore: number;
      effectiveWeight: number;
      evidenceId: string;
    }
  | {
      status: 'excluded';
      ruleId: string;
      dimension: Dimension;
      metricId: string;
      excludedReason: string;
      effectiveWeight: 0;
      evidenceId?: string;
    };

export interface PerPhotoRuleScoreV3 {
  photoId: PhotoRoleV3;
  rawTotal: number;
  dimensionRaw: Record<Dimension, number>;
  dimensionEffectiveWeight: Record<Dimension, number>;
  contributions: RuleContributionV3[];
  validRuleIds: string[];
}

/** Strict union so `no_score` cannot smuggle a composite (eng spec §6). */
export type ScoreOutcomeV3 =
  | {
      status: 'scored';
      scoringVersion: typeof SCORING_VERSION;
      compositeScore: number;
      rawComposite: number;
      dimensionDisplay: Record<Dimension, number>;
      perPhoto: [PerPhotoRuleScoreV3];
    }
  | {
      status: 'no_score';
      reason: NoScoreReason;
      failedPhotoIds?: string[];
      perPhoto?: PerPhotoRuleScoreV3[];
    };

export interface PhotoV3 {
  id: PhotoRoleV3;
  quality: QualityVerdict;
  // Overlay data-URLs live here; wiped before sessionStorage quota retry and
  // always stripped from the download payload.
  annotatedRef?: string;
}

export interface MethodV3 {
  ranLocally: true;
  uploaded: false;
  limitations: string[];
}

export interface AnalysisV3 {
  version: typeof ANALYSIS_V3_VERSION;
  scoringVersion: typeof SCORING_VERSION;
  landmarkModelVersion: typeof LANDMARK_MODEL_VERSION;
  qualityVersion: typeof QUALITY_VERSION;
  createdAt: string;
  adultConfirmed: true;
  photos: [PhotoV3];
  score: ScoreOutcomeV3;
  metrics: Record<string, RuleMetric>;
  evidence: Record<string, Evidence>;
  recommendations: RecommendationCard[];
  method: MethodV3;
  // local-rules-2.0.0+: descriptive face-shape label. Advisory only — never a
  // score input, never sent to analytics. Absent on legacy stored payloads.
  faceShape?: FaceShapeLabel;
  // skin-signals-1.0.0+: descriptive skin-quality signals (pixel statistics).
  // Advisory only — never a score input, absent on legacy payloads and on
  // no_score outcomes (no score may ride along with a rejected photo).
  skinQuality?: SkinQualityV3;
  // demographics-genderage-1.0.0+: rough appearance-based age/gender estimate
  // from a browser-local ONNX model. Advisory only, may be uncertain or
  // unavailable; never a score input, absent on legacy payloads and on
  // no_score outcomes.
  demographics?: DemographicsV3;
}

export function v3RuleEvidenceId(photoId: string, ruleId: string): string {
  return `v3:${photoId}:rule:${ruleId}`;
}

export function v3MetricKey(photoId: string, metricId: string): string {
  return `${photoId}:${metricId}`;
}

export function reliabilityFromQuality(verdict: QualityVerdict): ReliabilityV3 {
  const grades = [
    verdict.checks.pose,
    verdict.checks.blur,
    verdict.checks.exposure,
    verdict.checks.occlusion,
    verdict.checks.expression,
    verdict.checks.filterSigns,
  ];
  return grades.every((g) => g === undefined || g === 'pass') ? 'pass' : 'warn';
}

/** Maps an engine PhotoScore into the V3 contract, filling metrics + evidence. */
export function toV3PhotoScore(
  score: PhotoScore,
  photoId: PhotoRoleV3,
  reliability: ReliabilityV3,
  metrics: Record<string, RuleMetric>,
  evidence: Record<string, Evidence>
): PerPhotoRuleScoreV3 {
  const contributions: RuleContributionV3[] = score.contributions.map(
    (c: RuleContribution): RuleContributionV3 => {
      const rule = SCORE_RULES.find((r) => r.id === c.ruleId);
      const evidenceId = v3RuleEvidenceId(photoId, c.ruleId);
      if (
        c.status === 'included' &&
        c.metricValue !== undefined &&
        c.rawScore !== undefined
      ) {
        evidence[evidenceId] = { kind: 'rule', ruleId: c.ruleId };
        metrics[v3MetricKey(photoId, c.metricId)] = {
          metricId: c.metricId,
          value: c.metricValue,
          unit: 'ratio',
          reliability,
          evidenceId,
          landmarkIds: rule ? [...rule.requiredLandmarks] : [],
        };
        return {
          status: 'included',
          ruleId: c.ruleId,
          dimension: c.dimension,
          metricId: c.metricId,
          metricValue: c.metricValue,
          rawScore: c.rawScore,
          effectiveWeight: c.effectiveWeight,
          evidenceId,
        };
      }
      return {
        status: 'excluded',
        ruleId: c.ruleId,
        dimension: c.dimension,
        metricId: c.metricId,
        excludedReason: c.excludedReason ?? 'unspecified',
        effectiveWeight: 0,
      };
    }
  );
  return {
    photoId,
    rawTotal: score.rawTotal,
    dimensionRaw: { ...score.dimensionRaw },
    dimensionEffectiveWeight: { ...score.dimensionEffectiveWeight },
    contributions,
    validRuleIds: [...score.validRuleIds],
  };
}

/** Engine-side outcome handed to the V3 converter by the pipeline. */
export type ScoreOutcomeInputV3 =
  | { status: 'scored'; score: PhotoScore }
  | { status: 'no_score'; reason: NoScoreReason; failedPhotoIds?: string[] };

/** Converts a single-photo engine score into the V3 contract, deriving the
 *  0–10 display values and filling metrics + evidence. */
export function toV3ScoreOutcome(
  input: ScoreOutcomeInputV3,
  verdict: QualityVerdict,
  metrics: Record<string, RuleMetric>,
  evidence: Record<string, Evidence>
): ScoreOutcomeV3 {
  if (input.status === 'scored') {
    const rawComposite = input.score.rawTotal;
    const dimensionDisplay = {} as Record<Dimension, number>;
    for (const d of Object.keys(DIMENSION_WEIGHTS) as Dimension[])
      dimensionDisplay[d] = toDisplay10Dimension(
        d,
        input.score.dimensionRaw[d]
      );
    return {
      status: 'scored',
      scoringVersion: SCORING_VERSION,
      compositeScore: toDisplay10(rawComposite),
      rawComposite,
      dimensionDisplay,
      perPhoto: [
        toV3PhotoScore(
          input.score,
          'front',
          reliabilityFromQuality(verdict),
          metrics,
          evidence
        ),
      ],
    };
  }
  const noScore: ScoreOutcomeV3 = {
    status: 'no_score',
    reason: input.reason,
  };
  if (input.failedPhotoIds) noScore.failedPhotoIds = [...input.failedPhotoIds];
  return noScore;
}

// --- runtime validation (loadResult / download integrity) -------------------

const NO_SCORE_REASONS: readonly string[] = [
  'quality_failed',
  'insufficient_metrics',
  'model_failed',
  'unsupported_browser',
];
// Derived so the validator can never drift from the rule table's dimension set.
const DIMENSIONS: readonly string[] = Object.keys(DIMENSION_WEIGHTS);
const FACE_SHAPE_ESTIMATES: readonly string[] = [
  'oval',
  'round',
  'square',
  'heart',
  'oblong',
  'undetermined',
];
const AGE_BANDS: readonly string[] = ['<20', '20-35', '35-50', '50+'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isScore0100 = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 100;
// v3 display scale: 0..10 with at most one decimal (score-display.ts mapping).
const isScore010 = (v: unknown): v is number =>
  isNum(v) && v >= 0 && v <= 10 && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isStr);

function isGrade(v: unknown): boolean {
  return v === 'pass' || v === 'warn' || v === 'fail';
}

function isQualityVerdictV3(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (typeof v.pass !== 'boolean') return false;
  if (!isObj(v.checks)) return false;
  const c = v.checks;
  if (
    !isGrade(c.pose) ||
    !isGrade(c.blur) ||
    !isGrade(c.exposure) ||
    !isGrade(c.occlusion)
  )
    return false;
  // expression is optional for legacy stored payloads (pre quality-1.3.0).
  if (c.expression !== undefined && !isGrade(c.expression)) return false;
  if (!Array.isArray(v.reasons) || !v.reasons.every(isStr)) return false;
  return true;
}

function isPerPhotoRuleScoreV3(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.photoId !== 'front' || !isScore0100(v.rawTotal)) return false;
  const dimRaw = v.dimensionRaw;
  const dimEff = v.dimensionEffectiveWeight;
  if (!isObj(dimRaw) || !DIMENSIONS.every((d) => isScore0100(dimRaw[d])))
    return false;
  if (!isObj(dimEff) || !DIMENSIONS.every((d) => isNum(dimEff[d])))
    return false;
  if (!isStringArray(v.validRuleIds)) return false;
  if (!Array.isArray(v.contributions)) return false;
  return v.contributions.every((c) => {
    if (
      !isObj(c) ||
      !isStr(c.ruleId) ||
      !DIMENSIONS.includes(c.dimension as string)
    )
      return false;
    if (c.status === 'included')
      return (
        isScore0100(c.metricValue) &&
        isScore0100(c.rawScore) &&
        isNum(c.effectiveWeight) &&
        isStr(c.metricId) &&
        isStr(c.evidenceId)
      );
    if (c.status === 'excluded')
      return (
        c.effectiveWeight === 0 && isStr(c.metricId) && isStr(c.excludedReason)
      );
    return false;
  });
}

function isScoreOutcomeV3(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.status === 'scored') {
    if (!isScore010(v.compositeScore)) return false;
    if (!isScore0100(v.rawComposite)) return false;
    if (v.scoringVersion !== SCORING_VERSION) return false;
    const dimDisp = v.dimensionDisplay;
    if (!isObj(dimDisp) || !DIMENSIONS.every((d) => isScore010(dimDisp[d])))
      return false;
    if (!Array.isArray(v.perPhoto) || v.perPhoto.length !== 1) return false;
    return v.perPhoto.every(isPerPhotoRuleScoreV3);
  }
  if (v.status === 'no_score') {
    if (!isStr(v.reason) || !NO_SCORE_REASONS.includes(v.reason)) return false;
    // PRD §5.5: a no-score outcome must never carry a total, old or otherwise.
    if ('compositeScore' in v || 'rawComposite' in v) return false;
    if (
      v.perPhoto !== undefined &&
      (!Array.isArray(v.perPhoto) || !v.perPhoto.every(isPerPhotoRuleScoreV3))
    )
      return false;
    return true;
  }
  return false;
}

function isSkinAnalysisV3(v: unknown): boolean {
  if (!isObj(v) || v.version !== SKIN_VERSION) return false;
  if (v.status === 'low_signal') {
    // A refused grading must never carry a score (same rule as no_score).
    if ('display' in v || 'raw' in v) return false;
    if (v.reasons !== undefined && !isStringArray(v.reasons)) return false;
    return true;
  }
  if (v.status !== 'estimated') return false;
  if (!isScore010(v.display) || !isScore0100(v.raw)) return false;
  const s = v.signals;
  if (!isObj(s) || !isNum(s.textureRel) || !isNum(s.evenness) || !isNum(s.shine))
    return false;
  if (v.coverage !== undefined) {
    const c = v.coverage;
    if (
      !isObj(c) ||
      !isNum(c.cheekSkinRatio) ||
      typeof c.foreheadUsable !== 'boolean' ||
      !isNum(c.sampleCount)
    )
      return false;
  }
  if (v.reasons !== undefined && !isStringArray(v.reasons)) return false;
  return true;
}

function isDemographicsV3(v: unknown): boolean {
  if (!isObj(v) || v.version !== DEMOGRAPHICS_VERSION) return false;
  if (v.modelId !== DEMOGRAPHICS_MODEL_ID) return false;
  if (v.status === 'unavailable') {
    if (v.gender !== undefined || v.ageYears !== undefined || v.ageBand !== undefined)
      return false;
    if (v.reasons !== undefined && !isStringArray(v.reasons)) return false;
    return true;
  }
  if (v.gender !== undefined && v.gender !== 'male' && v.gender !== 'female')
    return false;
  if (v.genderMargin !== undefined && !isNum(v.genderMargin)) return false;
  if (v.ageYears !== undefined && !isNum(v.ageYears)) return false;
  if (v.ageBand !== undefined && !AGE_BANDS.includes(v.ageBand as string))
    return false;
  if (v.reasons !== undefined && !isStringArray(v.reasons)) return false;
  if (v.status === 'estimated') {
    // A claimed estimate must be complete.
    if (v.gender === undefined || v.ageYears === undefined || v.ageBand === undefined)
      return false;
    if (!isNum(v.genderMargin)) return false;
  }
  return true;
}

/** Full runtime validation of a deserialized/stored report (eng spec §6). */
export function isAnalysisV3(value: unknown): value is AnalysisV3 {
  if (!isObj(value)) return false;
  if (value.version !== ANALYSIS_V3_VERSION) return false;
  if (value.scoringVersion !== SCORING_VERSION) return false;
  if (!isStr(value.landmarkModelVersion) || !value.landmarkModelVersion)
    return false;
  if (!isStr(value.qualityVersion) || !value.qualityVersion) return false;
  if (!isStr(value.createdAt) || Number.isNaN(Date.parse(value.createdAt)))
    return false;
  if (value.adultConfirmed !== true) return false;

  if (!Array.isArray(value.photos) || value.photos.length !== 1) return false;
  const [p] = value.photos;
  if (!isObj(p) || p.id !== 'front' || !isQualityVerdictV3(p.quality))
    return false;

  if (!isScoreOutcomeV3(value.score)) return false;

  if (!isObj(value.metrics)) return false;
  for (const m of Object.values(value.metrics)) {
    if (!isObj(m) || !isStr(m.metricId) || !isNum(m.value) || m.value < 0)
      return false;
    if (m.unit !== 'ratio') return false;
    if (m.reliability !== 'pass' && m.reliability !== 'warn') return false;
    if (!isStr(m.evidenceId)) return false;
    if (!Array.isArray(m.landmarkIds) || !m.landmarkIds.every(isNum))
      return false;
  }

  if (!isObj(value.evidence)) return false;
  for (const e of Object.values(value.evidence)) {
    if (!isObj(e) || !isStr(e.kind)) return false;
  }

  if (!Array.isArray(value.recommendations)) return false;
  for (const r of value.recommendations) {
    if (!isObj(r) || !isStringArray(r.evidenceIds)) return false;
    if (!isStr(r.action) || !isStr(r.observedFeature)) return false;
  }

  if (!isObj(value.method)) return false;
  if (value.method.ranLocally !== true || value.method.uploaded !== false)
    return false;
  if (!isStringArray(value.method.limitations)) return false;
  if (value.faceShape !== undefined) {
    const fs = value.faceShape;
    if (!isObj(fs) || !isStr(fs.estimate) || typeof fs.consistent !== 'boolean')
      return false;
    if (!FACE_SHAPE_ESTIMATES.includes(fs.estimate)) return false;
  }
  if (value.skinQuality !== undefined && !isSkinAnalysisV3(value.skinQuality))
    return false;
  if (value.demographics !== undefined && !isDemographicsV3(value.demographics))
    return false;
  return true;
}

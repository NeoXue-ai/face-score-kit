// V3 browser pipeline (eng spec §3/§4): one front photo → detect → quality (A)
// → scorable strict gate → rule scoring (B) → AnalysisV3. Since
// local-rules-3.1.0 there is no dual-photo stability gate — one photo, one
// score. Nothing leaves the tab: no fetch, no persistence beyond the caller's
// sessionStorage handoff.

import {
  ANALYSIS_V3_VERSION,
  toV3ScoreOutcome,
  type AnalysisV3,
  type Evidence,
  type NoScoreReason,
  type PhotoRoleV3,
  type PhotoV3,
  type QualityVerdict,
  type RuleMetric,
  type ScoreOutcomeInputV3,
} from '../analysis-schema';
import { renderOverlay } from './annotate';
import {
  classifyFaceShape,
  faceShapeLabel,
  type FaceShape,
} from './face-shape';
import { AnalysisError, detectFromFile, type Detection } from './landmarks';
import { assessQuality, gradeOcclusion } from './quality';
import { QUALITY_THRESHOLDS } from './quality-thresholds';
import { buildRecommendationsV3 } from './recommendations-v3';
import { analyzeSkin, type SkinAnalysis } from './skin';
import { estimateDemographics, type DemographicsAnalysis } from './demographics';
import {
  ALL_SCORING_LANDMARKS,
  LANDMARK_MODEL_VERSION,
  QUALITY_VERSION,
  scorePhoto,
  SCORING_VERSION,
  type PhotoScore,
  type Pt,
} from './score-rules';

// Unstable-shot loop breaker (rules doc §6): max 3 quality-failed rounds per
// browsing session. Was carried on STABILITY in the dual-photo era.
export const RETAKE_LIMIT = 3;

// Every rule input plus both irises — the §5 condition-5 admission gate set.
const SCORING_POINTS: number[] = Array.from(
  new Set([...ALL_SCORING_LANDMARKS, 468, 473])
).sort((a, b) => a - b);

export type ScorableCode =
  | 'face_count'
  | 'quality_grades'
  | 'face_too_small'
  | 'edge_clipped'
  | 'landmarks_out_of_frame';

export interface ScorableResult {
  ok: boolean;
  codes: ScorableCode[];
}

/**
 * Strict scoring admission (rules doc §5, quality-1.2.0). Stricter than
 * assessQuality.pass: any warn on pose/blur/exposure fails here. Quality is
 * admission only — it never adds or subtracts score.
 */
export function scorablePhoto(
  detection: Detection,
  verdict: QualityVerdict
): ScorableResult {
  const codes: ScorableCode[] = [];

  if (verdict.checks.faceCount !== 1) {
    codes.push('face_count');
    return { ok: false, codes };
  }

  const { pose, blur, exposure } = verdict.checks;
  if (pose !== 'pass' || blur !== 'pass' || exposure !== 'pass')
    codes.push('quality_grades');

  const landmarks = detection.landmarks;
  if (!landmarks) {
    codes.push('face_count');
    return { ok: false, codes };
  }

  const occ = gradeOcclusion(landmarks, detection.width, detection.height);
  if (occ.faceWidthPx < QUALITY_THRESHOLDS.minFaceWidthPx)
    codes.push('face_too_small');
  if (occ.grade !== 'pass') codes.push('edge_clipped');

  for (const idx of SCORING_POINTS) {
    const pt = landmarks[idx] as Pt | undefined;
    if (
      !pt ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1]) ||
      pt[0] < 0 ||
      pt[0] > detection.width ||
      pt[1] < 0 ||
      pt[1] > detection.height
    ) {
      codes.push('landmarks_out_of_frame');
      break;
    }
  }

  return { ok: codes.length === 0, codes };
}

export interface V3PhotoInput {
  role: PhotoRoleV3;
  file: File;
}

export interface RunV3Options {
  adultConfirmed: true;
}

export type RunV3Failure = {
  kind: 'model_load_failed';
  message: string;
  code?: 'gpu_cpu_unavailable' | 'model_download_failed';
};

export interface RunV3Success {
  analysis: AnalysisV3;
  /** UI-only slot gate feedback; never persisted into the V3 contract. */
  scorable: ScorableResult;
}

export type RunV3Result = RunV3Success | RunV3Failure;

export function isRunV3Failure(value: RunV3Result): value is RunV3Failure {
  return 'kind' in value;
}

function photoFaceShape(p: PhotoScore | undefined): FaceShape | null {
  if (!p) return null;
  const includedValue = (ruleId: string): number | undefined =>
    p.contributions.find((c) => c.ruleId === ruleId && c.status === 'included')
      ?.metricValue;
  const heightWidth = includedValue('C1');
  const jawCheek = includedValue('C3');
  const templeCheek = includedValue('C2');
  if (
    heightWidth === undefined ||
    jawCheek === undefined ||
    templeCheek === undefined
  )
    return null;
  return classifyFaceShape({ heightWidth, jawCheek, templeCheek });
}

export interface AdvisoryExtras {
  skinQuality?: SkinAnalysis;
  demographics?: DemographicsAnalysis;
}

function buildAnalysis(
  input: ScoreOutcomeInputV3,
  verdict: QualityVerdict,
  detection: Detection | null,
  extras: AdvisoryExtras = {}
): AnalysisV3 {
  const metrics: Record<string, RuleMetric> = {};
  const evidence: Record<string, Evidence> = {};
  const scoreV3 = toV3ScoreOutcome(input, verdict, metrics, evidence);

  const photo: PhotoV3 = { id: 'front', quality: verdict };
  if (detection?.landmarks) {
    try {
      const ctx = detection.canvas.getContext('2d');
      if (ctx)
        photo.annotatedRef = renderOverlay(
          detection.canvas,
          ctx,
          detection.landmarks
        );
    } catch {
      /* report renders without the overlay */
    }
  }

  return {
    version: ANALYSIS_V3_VERSION,
    scoringVersion: SCORING_VERSION,
    landmarkModelVersion: LANDMARK_MODEL_VERSION,
    qualityVersion: QUALITY_VERSION,
    createdAt: new Date().toISOString(),
    adultConfirmed: true,
    photos: [photo],
    score: scoreV3,
    metrics,
    evidence,
    recommendations: buildRecommendationsV3(scoreV3, metrics),
    faceShape: faceShapeLabel(
      input.status === 'scored' ? photoFaceShape(input.score) : null
    ),
    // Advisory blocks ride only on scored outcomes — a rejected photo must
    // not carry any graded value (same contract as no_score / low_signal).
    skinQuality: extras.skinQuality,
    demographics: extras.demographics,
    method: {
      ranLocally: true,
      uploaded: false,
      limitations: [
        'The score is a rule-based aesthetic reference index (0-10), normal-calibrated against a synthetic population so most faces land between 5 and 7. Rule curves are product conventions anchored to common anthropometric ranges - not measured population norms, medical standards, or claims about objective beauty, and not a percentile or a prediction of how anyone rates you.',
        '分数是规则审美参考分(0-10),按合成人群做正态校准,大多数人落在 5-7 之间。规则曲线是产品评分约定,参考人体测量常见区间 - 不是真人实测常模、医学标准或客观审美;分数也不是百分位或他人对你的评价预测。',
        'Results depend on photo quality (lighting, angle, resolution). Pitch, expression, filters and general occlusion have no automatic detection - the shooting guide asks you to self-check them.',
        'The skin-quality readout is a pixel-statistics reference (texture/evenness/shine), not a dermatological assessment. The gender and age readout is a rough appearance estimate from a browser-local model and can simply be wrong - it is shown only when the model is confident enough, and it never affects the score.',
        '皮肤质量为像素统计参考(纹理/均匀度/光泽),不是皮肤医学评估;性别与年龄段是浏览器本地模型的粗略外观估计,可能出错 - 仅在模型置信度足够时展示,且不参与任何评分。',
      ],
    },
  };
}

export async function runAnalysisV3(
  photo: V3PhotoInput,
  opts: RunV3Options
): Promise<RunV3Result> {
  if (opts.adultConfirmed !== true)
    throw new Error('runAnalysisV3 requires adultConfirmed');
  if (photo.role !== 'front')
    throw new Error('runAnalysisV3 expects a single front photo');

  let detection: Detection;
  try {
    detection = await detectFromFile(photo.file);
  } catch (err) {
    if (err instanceof AnalysisError)
      return {
        kind: 'model_load_failed',
        message: err.message,
        code: err.code,
      };
    return {
      kind: 'model_load_failed',
      message: 'Face model could not be loaded',
    };
  }

  const verdict = assessQuality(detection);
  const scorable = scorablePhoto(detection, verdict);

  if (!scorable.ok) {
    return {
      analysis: buildAnalysis(
        {
          status: 'no_score',
          reason: 'quality_failed',
          failedPhotoIds: ['front'],
        },
        verdict,
        detection
      ),
      scorable,
    };
  }

  const result = scorePhoto('front', detection.landmarks as Pt[], {
    width: detection.width,
    height: detection.height,
  });

  if (result.status === 'unscorable') {
    const reason: NoScoreReason =
      result.reason === 'model_failed'
        ? 'model_failed'
        : 'insufficient_metrics';
    return {
      analysis: buildAnalysis(
        { status: 'no_score', reason, failedPhotoIds: ['front'] },
        verdict,
        detection
      ),
      scorable,
    };
  }

  // Advisory extras (skin signals, age/gender estimate) run only after the
  // strict scorable gate and only alongside a scored outcome. Each is
  // best-effort: a failure degrades to a missing advisory block, never to a
  // failed analysis.
  const [skinQuality, demographics] = await Promise.all([
    (async () => analyzeSkin(detection))().catch(() => undefined),
    estimateDemographics(detection).catch(() => undefined),
  ]);

  return {
    analysis: buildAnalysis(
      { status: 'scored', score: result.score },
      verdict,
      detection,
      { skinQuality, demographics }
    ),
    scorable,
  };
}

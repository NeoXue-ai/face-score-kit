// face-score-kit — public API.
//
// A fully client-side face analysis toolkit: rule-based aesthetic scoring,
// pixel-statistics skin signals, local-model age/gender estimation, face-shape
// classification and annotated overlays. Nothing ever leaves the browser tab —
// no fetch to an app server, no upload, no persistence beyond the caller.
//
// The heavy assets (MediaPipe wasm + face_landmarker.task, onnxruntime-web
// wasm) load lazily on first analysis: MediaPipe from pinned CDN URLs inside
// landmarks.ts, the genderage ONNX from demographicsConfig.modelUrl (override
// before first inference to self-host).

export {
  // Entry point: one front photo (File) -> AnalysisV3.
  runAnalysisV3,
  isRunV3Failure,
  scorablePhoto,
  RETAKE_LIMIT,
  type V3PhotoInput,
  type RunV3Options,
  type RunV3Result,
  type RunV3Failure,
  type RunV3Success,
  type ScorableCode,
  type ScorableResult,
  type AdvisoryExtras,
} from './analysis/pipeline';

export {
  detectFromFile,
  getLandmarker,
  AnalysisError,
  MAX_ANALYZE_DIM,
  type Detection,
  type LandmarkFailureCode,
} from './analysis/landmarks';

export { renderOverlay } from './analysis/annotate';

export {
  // Pure rule scoring (node-testable, no DOM).
  scorePhoto,
  SCORING_VERSION,
  QUALITY_VERSION,
  LANDMARK_MODEL_VERSION,
  SCORE_RULES,
  DIMENSION_WEIGHTS,
  validateRuleTable,
  ALL_SCORING_LANDMARKS,
  band,
  deviation,
  type PhotoScore,
  type Dimension,
  type Pt,
  type RuleDef,
  type ScoringFrame,
} from './analysis/score-rules';

export {
  toDisplay10,
  toDisplay10Dimension,
  DISPLAY_SCALE,
  DIMENSION_SCALE,
} from './analysis/score-display';

export {
  // Quality checks: pure image-statistics graders + soft verdict.
  assessQuality,
  gradeOcclusion,
  gradeBlur,
  gradeExposure,
  gradePose,
  gradeExpression,
  grayscaleFromRGBA,
  laplacianVariance,
  exposureRatios,
  faceRegion,
} from './analysis/quality';

export { QUALITY_THRESHOLDS } from './analysis/quality-thresholds';

export {
  // Skin signals: pure pixel statistics, advisory-only, never in the score.
  analyzeSkin,
  sampleSkinFromDetection,
  skinSignalBands,
  mapSkinDisplay,
  isSkinPixel,
  rgbToLab,
  SKIN_VERSION,
  SKIN_THRESHOLDS,
  type SkinAnalysis,
  type SkinSignals,
  type SkinCoverage,
  type PixelSource,
} from './analysis/skin';

export {
  // Age/gender: local ONNX inference, advisory-only, never in the score.
  estimateDemographics,
  decodeGenderAge,
  ageToBand,
  gradePrediction,
  demographicsConfig,
  DEMOGRAPHICS_VERSION,
  DEMOGRAPHICS_THRESHOLDS,
  MODEL_ID,
  type DemographicsAnalysis,
  type GenderAgePrediction,
  type AgeBand,
} from './analysis/demographics';

export {
  classifyFaceShape,
  faceShapeLabel,
  FACE_SHAPE_CUTS,
  type FaceShape,
  type FaceShapeRatios,
  type FaceShapeLabel as FaceShapeLabelInfo,
} from './analysis/face-shape';

export {
  buildRecommendationsV3,
  REC_TRIGGER_MAX,
  REC_MAX_CARDS,
} from './analysis/recommendations-v3';

export {
  // V3 data contract + runtime validators.
  ANALYSIS_V3_VERSION,
  toV3ScoreOutcome,
  toV3PhotoScore,
  isAnalysisV3,
  isRenderableRecommendation,
  v3MetricKey,
  v3RuleEvidenceId,
  reliabilityFromQuality,
  type AnalysisV3,
  type PhotoV3,
  type PhotoRoleV3,
  type ScoreOutcomeV3,
  type ScoreOutcomeInputV3,
  type NoScoreReason,
  type QualityVerdict,
  type QualityChecks,
  type QualityReasonKey,
  type Grade,
  type ReliabilityV3,
  type RuleMetric,
  type RuleContributionV3,
  type PerPhotoRuleScoreV3,
  type MethodV3,
  type Evidence,
  type RecommendationCard,
  type SkinQualityV3,
  type DemographicsV3,
} from './analysis-schema';

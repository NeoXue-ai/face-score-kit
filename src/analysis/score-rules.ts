// Local rule scoring — the single source of scoring truth.
// Contract: docs/rules/scoring-rules-v3.md. Changing any parameter, curve or
// pipeline step here REQUIRES bumping SCORING_VERSION, updating the rules doc
// (incl. method copy) and re-running the score-rules tests.
// Pure module: no DOM, no network, no Date, no env reads.

export const SCORING_VERSION = 'local-rules-3.2.0' as const;
export const QUALITY_VERSION = 'quality-1.3.0' as const;
export const LANDMARK_MODEL_VERSION =
  'mediapipe-tasks-vision@0.10.35/face_landmarker.float16.v1' as const;

export type Dimension =
  | 'proportion'
  | 'balance'
  | 'eyes'
  | 'nose'
  | 'mouth'
  | 'lower';

export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  proportion: 0.2,
  balance: 0.2,
  eyes: 0.15,
  nose: 0.12,
  mouth: 0.14,
  lower: 0.19,
};

// Coverage gates (rules doc §6). Three-rule dims carry a lower single-rule
// weight, so their admission threshold drops to 0.5 (= one rule's worth).
export const COVERAGE = {
  minRulesPerDimension: 2,
  minEffectiveWeight: {
    proportion: 0.5,
    balance: 0.7,
    eyes: 0.65,
    nose: 0.5,
    mouth: 0.5,
    lower: 0.65,
  },
  minBalanceRules: 3,
  minTotalExpandedWeight: 0.8,
} as const;

// ---------------------------------------------------------------------------
// Continuous scoring curves (rules doc §2, v3). A metric exactly at the
// anthropometric center scores 100 and every deviation decays smoothly —
// there is no full-score plateau any more, which is what made nearly every
// face land near 100 under the v2 bands. Widths are derived from the frozen
// v2 parameter tuples (zero edge ≈ 2.5σ → ~4.4 there), so no new numbers
// entered the rule table.
// ---------------------------------------------------------------------------

// Curve width in "sigma units": the old zero-edge sits at 2.5σ.
export const CURVE_SIGMA_SPAN = 2.5;

export function band(
  x: number,
  fullLo: number,
  fullHi: number,
  zeroLo: number,
  zeroHi: number
): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const c = (fullLo + fullHi) / 2;
  const s =
    x < c ? (c - zeroLo) / CURVE_SIGMA_SPAN : (zeroHi - c) / CURVE_SIGMA_SPAN;
  if (!(s > 0)) return 0;
  const z = (x - c) / s;
  return 100 * Math.exp(-0.5 * z * z);
}

// Deviation metrics are best at 0 (their plateau upper bound `fullMax` is no
// longer scored — kept only for the ordered-parameter contract).
export function deviation(x: number, fullMax: number, zeroAt: number): number {
  if (!Number.isFinite(x) || x < 0) return Number.NaN;
  void fullMax;
  const s = zeroAt / CURVE_SIGMA_SPAN;
  if (!(s > 0)) return 0;
  const z = x / s;
  return 100 * Math.exp(-0.5 * z * z);
}

// ---------------------------------------------------------------------------
// Rule table (rules doc §3)
// ---------------------------------------------------------------------------

export type BandParams = [
  fullLo: number,
  fullHi: number,
  zeroLo: number,
  zeroHi: number,
];
export type DeviationParams = [fullMax: number, zeroAt: number];

export interface RuleDef {
  id: string;
  dimension: Dimension;
  metricId: string;
  weightWithinDimension: number;
  scoring:
    | { kind: 'band'; params: BandParams }
    | { kind: 'deviation'; params: DeviationParams };
  requiredLandmarks: number[];
  explanationKey: string;
}

const CAN = [33, 133, 263, 362] as const;
// Subject-right eye (image-left): 159 upper lid, 145 lower lid.
const EYE_R_V = [159, 145] as const;
// Subject-left eye (image-right): 386 upper lid, 374 lower lid.
const EYE_L_V = [386, 374] as const;

export const SCORE_RULES: readonly RuleDef[] = [
  {
    id: 'L2',
    dimension: 'proportion',
    metricId: 'forehead_segment_over_face_height',
    weightWithinDimension: 0.5,
    // v3.2 recalibration: the v3.0 Gaussian centered on the old v2 plateau
    // midpoint (0.40), but that midpoint was never an ideal — real adult
    // faces measure ~0.30-0.33 (mesh top sits at hairline level; eyes sit at
    // the crown-chin midpoint), so nearly everyone scored 40-70 and the
    // proportion bar pinned near the display floor. Re-centered on the
    // measured norm 0.32; zero edges stay frozen.
    // eye-line points are listed because the metric is referenced to them.
    scoring: { kind: 'band', params: [0.28, 0.36, 0.18, 0.65] },
    requiredLandmarks: [10, 152, ...CAN],
    explanationKey: 'rule.l2',
  },
  {
    id: 'C1',
    dimension: 'proportion',
    metricId: 'face_height_width_ratio',
    weightWithinDimension: 0.5,
    scoring: { kind: 'band', params: [1.1, 1.5, 0.9, 1.75] },
    requiredLandmarks: [10, 152],
    explanationKey: 'rule.c1',
  },
  {
    id: 'S1',
    dimension: 'balance',
    metricId: 'eye_width_asymmetry',
    weightWithinDimension: 0.25,
    scoring: { kind: 'deviation', params: [0.03, 0.2] },
    requiredLandmarks: [...CAN],
    explanationKey: 'rule.s1',
  },
  {
    id: 'S2',
    dimension: 'balance',
    metricId: 'palpebral_centre_vertical_offset',
    weightWithinDimension: 0.2,
    scoring: { kind: 'deviation', params: [0.012, 0.06] },
    requiredLandmarks: [...CAN],
    explanationKey: 'rule.s2',
  },
  {
    id: 'S3',
    dimension: 'balance',
    metricId: 'mouth_corner_vertical_offset',
    weightWithinDimension: 0.2,
    scoring: { kind: 'deviation', params: [0.015, 0.08] },
    requiredLandmarks: [61, 291],
    explanationKey: 'rule.s3',
  },
  {
    id: 'S4',
    dimension: 'balance',
    metricId: 'cheek_midline_distance_asymmetry',
    weightWithinDimension: 0.2,
    scoring: { kind: 'deviation', params: [0.04, 0.2] },
    requiredLandmarks: [234, 454, 10, 152],
    explanationKey: 'rule.s4',
  },
  {
    id: 'S5',
    dimension: 'balance',
    metricId: 'nose_tip_midline_offset',
    weightWithinDimension: 0.15,
    scoring: { kind: 'deviation', params: [0.02, 0.1] },
    requiredLandmarks: [4, 10, 152],
    explanationKey: 'rule.s5',
  },
  {
    id: 'L1',
    dimension: 'eyes',
    metricId: 'intercanthal_over_eye_width',
    weightWithinDimension: 0.3,
    scoring: { kind: 'band', params: [0.75, 1.5, 0.35, 2.0] },
    requiredLandmarks: [...CAN],
    explanationKey: 'rule.l1',
  },
  {
    id: 'E2',
    dimension: 'eyes',
    metricId: 'eye_width_over_face_width',
    weightWithinDimension: 0.35,
    scoring: { kind: 'band', params: [0.16, 0.24, 0.11, 0.3] },
    requiredLandmarks: [...CAN],
    explanationKey: 'rule.e2',
  },
  {
    id: 'E3',
    dimension: 'eyes',
    metricId: 'palpebral_height_ratio',
    weightWithinDimension: 0.35,
    // Height/width per eye, averaged; each eye stands or falls on its own canthi.
    scoring: { kind: 'band', params: [0.24, 0.44, 0.14, 0.55] },
    requiredLandmarks: [...CAN, ...EYE_R_V, ...EYE_L_V],
    explanationKey: 'rule.e3',
  },
  {
    id: 'N1',
    dimension: 'nose',
    metricId: 'nose_alar_over_intercanthal',
    weightWithinDimension: 0.5,
    // Band re-centered for the v2.1 canthal pairing fix: real photos measure
    // ~0.92–0.96 (alar width ≈ inner-canthal distance, the anthropometric
    // alignment of alae under the inner canthi).
    scoring: { kind: 'band', params: [0.72, 1.2, 0.5, 1.45] },
    requiredLandmarks: [98, 327, 133, 362],
    explanationKey: 'rule.n1',
  },
  {
    id: 'N2',
    dimension: 'nose',
    metricId: 'nose_length_over_midface',
    weightWithinDimension: 0.5,
    scoring: { kind: 'band', params: [0.33, 0.47, 0.24, 0.56] },
    requiredLandmarks: [168, 1, 152],
    explanationKey: 'rule.n2',
  },
  {
    id: 'L3',
    dimension: 'mouth',
    metricId: 'mouth_width_ratio',
    weightWithinDimension: 0.5,
    scoring: { kind: 'band', params: [0.25, 0.55, 0.15, 0.7] },
    requiredLandmarks: [61, 291],
    explanationKey: 'rule.l3',
  },
  {
    id: 'M2',
    dimension: 'mouth',
    metricId: 'lower_upper_lip_ratio',
    weightWithinDimension: 0.5,
    scoring: { kind: 'band', params: [1.2, 1.9, 0.8, 2.5] },
    requiredLandmarks: [12, 0, 17, 15],
    explanationKey: 'rule.m2',
  },
  {
    id: 'C3',
    dimension: 'lower',
    metricId: 'jaw_cheek_ratio',
    weightWithinDimension: 0.4,
    scoring: { kind: 'band', params: [0.65, 1.05, 0.48, 1.22] },
    requiredLandmarks: [172, 397],
    explanationKey: 'rule.c3',
  },
  {
    id: 'C2',
    dimension: 'lower',
    metricId: 'temple_cheek_ratio',
    weightWithinDimension: 0.3,
    // v1 band [0.75,1.12] was miscalibrated: pixel-space probe measured
    // 0.47-0.52 on real adult faces, so it scored ~0 for nearly everyone.
    scoring: { kind: 'band', params: [0.42, 0.72, 0.3, 0.88] },
    requiredLandmarks: [67, 297],
    explanationKey: 'rule.c2',
  },
  {
    id: 'J2',
    dimension: 'lower',
    metricId: 'lower_face_height_ratio',
    weightWithinDimension: 0.3,
    scoring: { kind: 'band', params: [0.18, 0.3, 0.12, 0.38] },
    requiredLandmarks: [10, 152, 0, 17],
    explanationKey: 'rule.j2',
  },
];

// Fail fast in dev/tests if the table drifts from the frozen contract.
export function validateRuleTable(): string[] {
  const problems: string[] = [];
  const byDim = {} as Record<Dimension, RuleDef[]>;
  for (const dim of Object.keys(DIMENSION_WEIGHTS) as Dimension[])
    byDim[dim] = [];
  const seen = new Set<string>();
  for (const r of SCORE_RULES) {
    if (seen.has(r.id)) problems.push(`${r.id}: duplicate id`);
    seen.add(r.id);
    byDim[r.dimension].push(r);
    if (!METRIC_EVALUATORS[r.metricId]) problems.push(`${r.id}: no evaluator`);
    if (r.scoring.kind === 'band') {
      const [fullLo, fullHi, zeroLo, zeroHi] = r.scoring.params;
      if (!(zeroLo < fullLo && fullLo < fullHi && fullHi < zeroHi))
        problems.push(`${r.id}: band params not ordered`);
    } else {
      const [fullMax, zeroAt] = r.scoring.params;
      if (!(fullMax >= 0 && fullMax < zeroAt))
        problems.push(`${r.id}: deviation params not ordered`);
    }
  }
  for (const dim of Object.keys(byDim) as Dimension[]) {
    const sum = byDim[dim].reduce((a, r) => a + r.weightWithinDimension, 0);
    if (Math.abs(sum - 1) > 1e-9) problems.push(`${dim}: weights sum ${sum}`);
  }
  const dw = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).reduce(
    (a, d) => a + DIMENSION_WEIGHTS[d],
    0
  );
  if (Math.abs(dw - 1) > 1e-9) problems.push(`dimension weights sum ${dw}`);
  return problems;
}

// ---------------------------------------------------------------------------
// Scoring frame: one rotation + normalization for the whole photo (§1)
// ---------------------------------------------------------------------------

export const ALL_SCORING_LANDMARKS = [
  ...new Set(SCORE_RULES.flatMap((r) => r.requiredLandmarks)),
].sort((a, b) => a - b);

const IRIS_L = 468;
const IRIS_R = 473;

export type Pt = [number, number];

export interface PhotoBounds {
  width: number;
  height: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function isFinitePt(p: Pt | undefined): p is Pt {
  return !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

export interface ScoringFrame {
  p: Record<number, Pt>; // required landmarks, rotated (only finite ones present)
  eyeLc: Pt | undefined; // rotated palpebral centre (mean of canthi)
  eyeRc: Pt | undefined;
  W: number; // bizygomatic width scale
  eyeLineY: number; // NaN when either palpebral centre is missing
  midlineUsable: boolean; // 10→152 axis defined and non-degenerate
  xAxis: (y: number) => number;
  bounds?: PhotoBounds;
}

export type FrameFailure =
  | { reason: 'frame_non_finite'; detail: 'iris' | 'cheeks' }
  | { reason: 'frame_width_zero' };

export type FrameResult =
  | { ok: true; frame: ScoringFrame }
  | ({ ok: false } & FrameFailure);

export function buildFrame(landmarks: Pt[], bounds?: PhotoBounds): FrameResult {
  const raw = (i: number): Pt | undefined => landmarks[i] as Pt | undefined;
  const iL = raw(IRIS_L);
  const iR = raw(IRIS_R);
  if (!isFinitePt(iL) || !isFinitePt(iR))
    return { ok: false, reason: 'frame_non_finite', detail: 'iris' };
  const cheekL = raw(234);
  const cheekR = raw(454);
  if (!isFinitePt(cheekL) || !isFinitePt(cheekR))
    return { ok: false, reason: 'frame_non_finite', detail: 'cheeks' };

  // Horizontal reference axis = pupil line; pivot = pupil midpoint. The line
  // angle is defined mod π (a mirrored face swaps which iris is "left"), so
  // normalise to (−90°, +90°] before de-rotating.
  let theta = Math.atan2(iR[1] - iL[1], iR[0] - iL[0]);
  if (theta > Math.PI / 2) theta -= Math.PI;
  else if (theta < -Math.PI / 2) theta += Math.PI;
  const mx = (iL[0] + iR[0]) / 2;
  const my = (iL[1] + iR[1]) / 2;
  // Rotation by −θ: x' = cosθ·dx + sinθ·dy, y' = −sinθ·dx + cosθ·dy.
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rotate = ([x, y]: Pt): Pt => [
    cos * (x - mx) + sin * (y - my) + mx,
    -sin * (x - mx) + cos * (y - my) + my,
  ];

  const p: Record<number, Pt> = {};
  for (const idx of ALL_SCORING_LANDMARKS) {
    const pt = raw(idx);
    if (isFinitePt(pt)) p[idx] = rotate(pt);
  }

  const W = dist(p[234], p[454]);
  if (!(W > 0) || !Number.isFinite(W))
    return { ok: false, reason: 'frame_width_zero' };

  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const eyeLc = p[33] && p[133] ? mid(p[33], p[133]) : undefined;
  const eyeRc = p[263] && p[362] ? mid(p[263], p[362]) : undefined;
  const eyeLineY = eyeLc && eyeRc ? (eyeLc[1] + eyeRc[1]) / 2 : Number.NaN;

  const forehead = p[10];
  const chin = p[152];
  const midlineUsable = !!forehead && !!chin && chin[1] - forehead[1] !== 0;
  const xAxis = (y: number): number =>
    forehead && chin
      ? forehead[0] +
        ((chin[0] - forehead[0]) * (y - forehead[1])) / (chin[1] - forehead[1])
      : Number.NaN;

  return {
    ok: true,
    frame: { p, eyeLc, eyeRc, W, eyeLineY, midlineUsable, xAxis, bounds },
  };
}

// ---------------------------------------------------------------------------
// Metric evaluators: value or an explicit exclusion reason (never 0)
// ---------------------------------------------------------------------------

export type MetricOutcome = { value: number } | { excluded: string };

function rulePointsUsable(frame: ScoringFrame, rule: RuleDef): boolean {
  for (const i of rule.requiredLandmarks) {
    const pt = frame.p[i];
    if (!pt) return false;
    if (frame.bounds) {
      const { width, height } = frame.bounds;
      if (pt[0] < 0 || pt[0] > width || pt[1] < 0 || pt[1] > height)
        return false;
    }
  }
  return true;
}

function relativeDiff(a: number, b: number): number | undefined {
  const mean = (a + b) / 2;
  if (!(mean > 0) || !Number.isFinite(mean)) return undefined;
  return Math.abs(a - b) / mean;
}

function eyeWidths(f: ScoringFrame): { l: number; r: number } | undefined {
  const l = dist(f.p[33], f.p[133]);
  const r = dist(f.p[263], f.p[362]);
  if (!(l > 0) || !(r > 0)) return undefined;
  return { l, r };
}

export const METRIC_EVALUATORS: Record<
  string,
  (f: ScoringFrame) => MetricOutcome
> = {
  intercanthal_over_eye_width: (f) => {
    const ew = eyeWidths(f);
    if (!ew) return { excluded: 'eye_width_zero' };
    // True inner canthi are 133 and 362 (263 is the OUTER canthus of the
    // other eye — pairing them was the v2.0 L1 miswiring).
    return { value: dist(f.p[133], f.p[362]) / ((ew.l + ew.r) / 2) };
  },
  forehead_segment_over_face_height: (f) => {
    if (!Number.isFinite(f.eyeLineY))
      return { excluded: 'eye_landmarks_missing' };
    const top = f.p[10][1];
    const chinY = f.p[152][1];
    if (top >= f.eyeLineY || !(chinY > top))
      return { excluded: 'forehead_landmark_invalid' };
    return { value: (f.eyeLineY - top) / (chinY - top) };
  },
  mouth_width_ratio: (f) => {
    const mw = dist(f.p[61], f.p[291]);
    if (!(mw > 0)) return { excluded: 'mouth_landmarks_degenerate' };
    return { value: mw / f.W };
  },
  eye_width_asymmetry: (f) => {
    const ew = eyeWidths(f);
    if (!ew) return { excluded: 'eye_width_zero' };
    const d = relativeDiff(ew.l, ew.r);
    return d === undefined ? { excluded: 'eye_width_zero' } : { value: d };
  },
  palpebral_centre_vertical_offset: (f) => {
    if (!f.eyeLc || !f.eyeRc) return { excluded: 'eye_landmarks_missing' };
    return { value: Math.abs(f.eyeLc[1] - f.eyeRc[1]) / f.W };
  },
  mouth_corner_vertical_offset: (f) => ({
    value: Math.abs(f.p[61][1] - f.p[291][1]) / f.W,
  }),
  cheek_midline_distance_asymmetry: (f) => {
    if (!f.midlineUsable) return { excluded: 'midline_degenerate' };
    const dL = Math.abs(f.p[234][0] - f.xAxis(f.p[234][1]));
    const dR = Math.abs(f.p[454][0] - f.xAxis(f.p[454][1]));
    const d = relativeDiff(dL, dR);
    return d === undefined ? { excluded: 'midline_degenerate' } : { value: d };
  },
  nose_tip_midline_offset: (f) => {
    if (!f.midlineUsable) return { excluded: 'midline_degenerate' };
    return { value: Math.abs(f.p[4][0] - f.xAxis(f.p[4][1])) / f.W };
  },
  face_height_width_ratio: (f) => ({ value: dist(f.p[10], f.p[152]) / f.W }),
  temple_cheek_ratio: (f) => ({ value: dist(f.p[67], f.p[297]) / f.W }),
  jaw_cheek_ratio: (f) => ({ value: dist(f.p[172], f.p[397]) / f.W }),
  eye_width_over_face_width: (f) => {
    const ew = eyeWidths(f);
    if (!ew) return { excluded: 'eye_width_zero' };
    return { value: (ew.l + ew.r) / 2 / f.W };
  },
  palpebral_height_ratio: (f) => {
    const ew = eyeWidths(f);
    if (!ew) return { excluded: 'eye_width_zero' };
    // 159/145 bound the 33↔133 eye; 386/374 bound the 263↔362 eye.
    const hl = dist(f.p[159], f.p[145]);
    const hr = dist(f.p[386], f.p[374]);
    if (!(hl > 0) || !(hr > 0)) return { excluded: 'lid_height_zero' };
    return { value: (hl / ew.l + hr / ew.r) / 2 };
  },
  nose_alar_over_intercanthal: (f) => {
    // Inner canthi are 133/362 (see L1); the v2.0 mispairing inflated this
    // denominator ~1.8x, so the band is recalibrated to the corrected ratio
    // (real photos land ~0.92–0.96).
    const ic = dist(f.p[133], f.p[362]);
    if (!(ic > 0)) return { excluded: 'intercanthal_zero' };
    return { value: dist(f.p[98], f.p[327]) / ic };
  },
  nose_length_over_midface: (f) => {
    const mid = dist(f.p[168], f.p[152]);
    if (!(mid > 0)) return { excluded: 'midface_zero' };
    return { value: dist(f.p[168], f.p[1]) / mid };
  },
  lower_upper_lip_ratio: (f) => {
    const upper = dist(f.p[12], f.p[0]);
    if (!(upper > 0)) return { excluded: 'upper_lip_degenerate' };
    return { value: dist(f.p[17], f.p[15]) / upper };
  },
  lower_face_height_ratio: (f) => {
    const chinY = f.p[152][1];
    const topY = f.p[10][1];
    if (!(chinY > topY)) return { excluded: 'face_height_zero' };
    const mouthY = (f.p[0][1] + f.p[17][1]) / 2;
    if (!(chinY > mouthY)) return { excluded: 'lower_face_degenerate' };
    return { value: (chinY - mouthY) / (chinY - topY) };
  },
};

function applyScoring(rule: RuleDef, x: number): number {
  return rule.scoring.kind === 'band'
    ? band(x, ...rule.scoring.params)
    : deviation(x, ...rule.scoring.params);
}

// ---------------------------------------------------------------------------
// Per-photo scoring + coverage gates (§6)
// ---------------------------------------------------------------------------

export interface RuleContribution {
  status: 'included' | 'excluded';
  ruleId: string;
  dimension: Dimension;
  metricId: string;
  metricValue?: number;
  rawScore?: number;
  effectiveWeight: number;
  excludedReason?: string;
}

export interface PhotoScore {
  photoId: string;
  rawTotal: number;
  dimensionRaw: Record<Dimension, number>;
  dimensionEffectiveWeight: Record<Dimension, number>;
  contributions: RuleContribution[];
  validRuleIds: string[];
}

export type ScorePhotoResult =
  | { status: 'scored'; score: PhotoScore }
  | {
      status: 'unscorable';
      reason: 'model_failed' | 'insufficient_metrics';
      detail?: string;
      contributions: RuleContribution[];
    };

export function scorePhoto(
  photoId: string,
  landmarks: Pt[],
  bounds?: PhotoBounds
): ScorePhotoResult {
  const built = buildFrame(landmarks, bounds);
  if (!built.ok)
    return {
      status: 'unscorable',
      reason: 'model_failed',
      detail:
        built.reason === 'frame_width_zero'
          ? 'W_zero'
          : `non_finite:${built.detail}`,
      contributions: [],
    };
  const frame = built.frame;

  const contributions: RuleContribution[] = [];
  const dims = Object.keys(DIMENSION_WEIGHTS) as Dimension[];
  const perDim = {} as Record<
    Dimension,
    { included: RuleContribution[]; weight: number }
  >;
  for (const dim of dims) perDim[dim] = { included: [], weight: 0 };

  for (const rule of SCORE_RULES) {
    let c: RuleContribution;
    const exclude = (reason: string): RuleContribution => ({
      status: 'excluded',
      ruleId: rule.id,
      dimension: rule.dimension,
      metricId: rule.metricId,
      effectiveWeight: 0,
      excludedReason: reason,
    });
    if (!rulePointsUsable(frame, rule)) {
      c = exclude('landmark_missing_or_out_of_frame');
    } else {
      const out = METRIC_EVALUATORS[rule.metricId](frame);
      if ('excluded' in out) {
        c = exclude(out.excluded);
      } else {
        const raw = applyScoring(rule, out.value);
        if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
          c = exclude('metric_out_of_range');
        } else {
          c = {
            status: 'included',
            ruleId: rule.id,
            dimension: rule.dimension,
            metricId: rule.metricId,
            metricValue: out.value,
            rawScore: raw,
            effectiveWeight: rule.weightWithinDimension,
          };
          perDim[rule.dimension].included.push(c);
          perDim[rule.dimension].weight += rule.weightWithinDimension;
        }
      }
    }
    contributions.push(c);
  }

  const gateFail: string[] = [];
  for (const dim of dims) {
    const { included, weight } = perDim[dim];
    const minRules =
      dim === 'balance'
        ? COVERAGE.minBalanceRules
        : COVERAGE.minRulesPerDimension;
    if (included.length < minRules) gateFail.push(`${dim}:rules<${minRules}`);
    if (weight + 1e-9 < COVERAGE.minEffectiveWeight[dim])
      gateFail.push(`${dim}:weight<${COVERAGE.minEffectiveWeight[dim]}`);
  }
  const expanded = dims.reduce(
    (a, dim) => a + DIMENSION_WEIGHTS[dim] * perDim[dim].weight,
    0
  );
  if (expanded + 1e-9 < COVERAGE.minTotalExpandedWeight)
    gateFail.push('total<0.8');
  if (gateFail.length > 0)
    return {
      status: 'unscorable',
      reason: 'insufficient_metrics',
      detail: gateFail.join(','),
      contributions,
    };

  const dimensionRaw = {} as Record<Dimension, number>;
  const dimensionEffectiveWeight = {} as Record<Dimension, number>;
  for (const dim of dims) {
    const { included, weight } = perDim[dim];
    // Every rawScore is in [0,100] by construction; fp accumulation can still
    // land a hair outside the declared domain, so clamp to it.
    dimensionRaw[dim] = Math.min(
      100,
      Math.max(
        0,
        included.reduce(
          (a, c) => a + (c.rawScore ?? 0) * c.effectiveWeight,
          0
        ) / weight
      )
    );
    dimensionEffectiveWeight[dim] = weight;
  }
  const rawTotal = Math.min(
    100,
    Math.max(
      0,
      dims.reduce((a, dim) => a + DIMENSION_WEIGHTS[dim] * dimensionRaw[dim], 0)
    )
  );
  if (!Number.isFinite(rawTotal) || rawTotal < 0 || rawTotal > 100)
    return {
      status: 'unscorable',
      reason: 'insufficient_metrics',
      detail: 'raw_total_invalid',
      contributions,
    };

  return {
    status: 'scored',
    score: {
      photoId,
      rawTotal,
      dimensionRaw,
      dimensionEffectiveWeight,
      contributions,
      validRuleIds: contributions
        .filter((c) => c.status === 'included')
        .map((c) => c.ruleId),
    },
  };
}

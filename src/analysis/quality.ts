import type {
  Grade,
  QualityChecks,
  QualityReasonKey,
  QualityVerdict,
} from "../analysis-schema"
import type { Detection } from "./landmarks"
import { QUALITY_THRESHOLDS as T } from "./quality-thresholds"

// Layer A — per-photo quality gate (spec 03). "Quality pass" ≠ "attractive":
// this only decides whether a photo is usable, and why not if it isn't.
//
// Signal sources are honestly separated:
//   - faceCount, pose, occlusion  → derived from MediaPipe landmarks
//   - blur, exposure              → our own image-signal processing on pixels
//     (Laplacian variance / brightness histogram) — NOT "AI detection".
// filterSigns and expression are intentionally NOT emitted in V2.0 (weak signal;
// see spec 03 open questions).

const LM = {
  noseTip: 4,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeOuter: 263,
  rightEyeInner: 362,
} as const

// --- pure pixel graders (no DOM — unit-testable in Node) --------------------

export function grayscaleFromRGBA(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return gray
}

export function laplacianVariance(
  gray: Float32Array,
  w: number,
  h: number,
  region?: { x0: number; y0: number; x1: number; y1: number }
): number {
  const xStart = Math.max(1, region ? region.x0 : 1)
  const xEnd = Math.min(w - 1, region ? region.x1 : w - 1)
  const yStart = Math.max(1, region ? region.y0 : 1)
  const yEnd = Math.min(h - 1, region ? region.y1 : h - 1)
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const c = y * w + x
      const lap =
        4 * gray[c] - gray[c - 1] - gray[c + 1] - gray[c - w] - gray[c + w]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

// Blur must be measured where detail matters: the face box. Whole-frame
// variance is diluted by soft backgrounds (portrait bokeh, plain walls) and
// false-rejects sharp faces (PRD §4 false-reject ≤10%).
export function faceRegion(
  landmarks: [number, number][],
  w: number,
  h: number
): { x0: number; y0: number; x1: number; y1: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const [x, y] of landmarks) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = Math.round((maxX - minX) * 0.15)
  return {
    x0: Math.max(0, minX - pad),
    y0: Math.max(0, minY - pad),
    x1: Math.min(w, maxX + pad),
    y1: Math.min(h, maxY + pad),
  }
}

export function gradeBlur(variance: number): Grade {
  if (variance < T.blur.fail) return "fail"
  if (variance < T.blur.warn) return "warn"
  return "pass"
}

export function exposureRatios(gray: Float32Array): { over: number; under: number } {
  let over = 0
  let under = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= T.exposure.highlightClipLevel) over++
    else if (gray[i] <= T.exposure.shadowClipLevel) under++
  }
  const total = gray.length || 1
  return { over: over / total, under: under / total }
}

export function gradeExposure(over: number, under: number): { grade: Grade; reasons: QualityReasonKey[] } {
  const reasons: QualityReasonKey[] = []
  let grade: Grade = "pass"
  for (const [ratio, key] of [
    [over, "overexposed"],
    [under, "underexposed"],
  ] as const) {
    if (ratio > T.exposure.fail) {
      grade = "fail"
      reasons.push(key)
    } else if (ratio > T.exposure.warn && grade !== "fail") {
      grade = "warn"
      reasons.push(key)
    } else if (ratio > T.exposure.warn) {
      reasons.push(key)
    }
  }
  return { grade, reasons }
}

// --- pure landmark graders ---------------------------------------------------

function worstOf(grades: Grade[]): Grade {
  if (grades.includes("fail")) return "fail"
  if (grades.includes("warn")) return "warn"
  return "pass"
}

export function gradePose(
  landmarks: [number, number][]
): { grade: Grade; reasons: QualityReasonKey[]; approximate: boolean } {
  const lc: [number, number] = [
    (landmarks[LM.leftEyeOuter][0] + landmarks[LM.leftEyeInner][0]) / 2,
    (landmarks[LM.leftEyeOuter][1] + landmarks[LM.leftEyeInner][1]) / 2,
  ]
  const rc: [number, number] = [
    (landmarks[LM.rightEyeOuter][0] + landmarks[LM.rightEyeInner][0]) / 2,
    (landmarks[LM.rightEyeOuter][1] + landmarks[LM.rightEyeInner][1]) / 2,
  ]
  const eyeDist = Math.hypot(rc[0] - lc[0], rc[1] - lc[1])
  if (eyeDist === 0) return { grade: "warn", reasons: ["pose_yaw"], approximate: true }

  const rollDeg = Math.abs((Math.atan2(rc[1] - lc[1], rc[0] - lc[0]) * 180) / Math.PI)
  const eyeMidX = (lc[0] + rc[0]) / 2
  const nose = landmarks[LM.noseTip]
  // Horizontal nose offset from the eye midline is a yaw proxy on a 2D image.
  const yawDeg = Math.abs((Math.atan2(nose[0] - eyeMidX, eyeDist / 2) * 180) / Math.PI)

  const reasons: QualityReasonKey[] = []
  const grades: Grade[] = []

  const axisGrade = (deg: number, pass: number, fail: number): Grade =>
    deg > fail ? "fail" : deg > pass ? "warn" : "pass"

  const yawGrade = axisGrade(yawDeg, T.pose.yawPass, T.pose.yawFail)
  const rollGrade = axisGrade(rollDeg, T.pose.rollPass, T.pose.rollFail)
  grades.push(yawGrade, rollGrade)
  if (yawGrade !== "pass") reasons.push("pose_yaw")
  if (rollGrade !== "pass") reasons.push("pose_roll")
  // Pitch is not gated from a single frontal 2D image (unreliable); noted here
  // so it is not mistaken for an implemented check.

  return { grade: worstOf(grades), reasons, approximate: true }
}

export function gradeOcclusion(
  landmarks: [number, number][],
  w: number,
  h: number
): { grade: Grade; reasons: QualityReasonKey[]; faceWidthPx: number } {
  let minX = Infinity
  let maxX = -Infinity
  for (const [x] of landmarks) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
  }
  const faceWidthPx = maxX - minX
  // Face box touching the frame edge is an out-of-frame / occlusion proxy.
  const clipped = minX <= 1 || maxX >= w - 2
  return {
    grade: clipped ? "warn" : "pass",
    reasons: clipped ? ["occlusion"] : [],
    faceWidthPx,
  }
}

// quality-1.3.0: expression grading from MediaPipe blendshapes — the same
// detect() call already emits 52 coefficients, so this signal costs no extra
// download. Soft check: warns only, never rejects (uncalibrated false-rejects).
export function gradeExpression(
  blendshapes: { categoryName: string; score: number }[] | null
): { grade: Grade; reasons: QualityReasonKey[] } {
  if (!blendshapes) return { grade: 'pass', reasons: [] }; // not emitted -> not graded
  const get = (n: string) => blendshapes.find((c) => c.categoryName === n)?.score ?? 0;
  const pairs: Array<[number, number, QualityReasonKey]> = [
    [get('jawOpen'), T.expression.jawOpen, 'expression_exaggerated'],
    [
      Math.max(get('mouthSmileLeft'), get('mouthSmileRight')),
      T.expression.smile,
      'expression_smile',
    ],
    [
      Math.max(get('browDownLeft'), get('browDownRight')),
      T.expression.browDown,
      'expression_brow',
    ],
    [get('cheekPuff'), T.expression.cheekPuff, 'expression_exaggerated'],
    [get('mouthPucker'), T.expression.mouthPucker, 'expression_exaggerated'],
  ];
  const reasons: QualityReasonKey[] = [];
  let grade: Grade = 'pass';
  for (const [score, threshold, key] of pairs) {
    if (score > threshold) {
      reasons.push(key);
      grade = 'warn';
    }
  }
  return { grade, reasons: Array.from(new Set(reasons)) };
}

// --- browser glue -----------------------------------------------------------

function readGrayscale(canvas: HTMLCanvasElement): { gray: Float32Array; w: number; h: number } | null {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const { width: w, height: h } = canvas
  const { data } = ctx.getImageData(0, 0, w, h)
  return { gray: grayscaleFromRGBA(data, w, h), w, h }
}

export function assessQuality(detection: Detection): QualityVerdict {
  const { faceCount, landmarks, width, height, canvas } = detection

  const faceCountGate: 0 | 1 | "multiple" =
    faceCount === 0 ? 0 : faceCount === 1 ? 1 : "multiple"

  const reasons: QualityReasonKey[] = []
  const hard: Grade[] = []

  let poseGrade: Grade = 'pass'
  let blurGrade: Grade = 'pass'
  let exposureGrade: Grade = 'pass'
  let occlusionGrade: Grade = 'pass'
  let expressionGrade: Grade = 'pass'

  if (faceCountGate === 0) {
    reasons.push('no_face')
  } else if (faceCountGate === 'multiple') {
    reasons.push('multiple_faces')
  } else if (landmarks) {
    const pose = gradePose(landmarks)
    poseGrade = pose.grade
    reasons.push(...pose.reasons)

    const expr = gradeExpression(detection.blendshapes ?? null)
    expressionGrade = expr.grade
    reasons.push(...expr.reasons)

    const occ = gradeOcclusion(landmarks, width, height)
    occlusionGrade = occ.grade
    reasons.push(...occ.reasons)
    if (occ.faceWidthPx > 0 && occ.faceWidthPx < T.minFaceWidthPx) {
      reasons.push("low_resolution")
    }

    const pixels = readGrayscale(canvas)
    if (pixels) {
      blurGrade = gradeBlur(
        laplacianVariance(pixels.gray, pixels.w, pixels.h, faceRegion(landmarks, width, height))
      )
      if (blurGrade !== "pass") reasons.push("blur")

      const exp = exposureRatios(pixels.gray)
      const exg = gradeExposure(exp.over, exp.under)
      exposureGrade = exg.grade
      reasons.push(...exg.reasons)
    }
  }

  const checks: QualityChecks = {
    faceCount: faceCountGate,
    pose: poseGrade,
    blur: blurGrade,
    exposure: exposureGrade,
    occlusion: occlusionGrade,
    expression: expressionGrade,
  }

  // Hard gate: exactly one face and no FAIL on pose/blur/exposure. Occlusion and
  // low_resolution are soft — they warn and surface reasons but don't reject
  // (keeps false-rejects within the PRD §4 target while data is uncalibrated).
  hard.push(faceCountGate === 1 ? "pass" : "fail", poseGrade, blurGrade, exposureGrade)
  const pass = faceCountGate === 1 && !hard.includes("fail")

  return { pass, checks, reasons: Array.from(new Set(reasons)) }
}

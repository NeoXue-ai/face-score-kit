// Centralized quality-gate thresholds (spec 03 §3.4). All values are engineering
// heuristics tuned on the downsampled ≤1280px canvas — NOT calibrated truth.
// The PRD §4 targets (detect ≥90% / false-reject ≤10%) and final numbers are a
// Phase-0 frozen-annotation-set evaluation deliverable, not web CI (spec 10).
// TODO(phase0): recalibrate every constant against the frozen quality set; the
// blur thresholds especially are resolution- and sensor-dependent.

export const QUALITY_THRESHOLDS = {
  // Pose is derived from 2D landmarks (yaw/roll) — a proxy, not the transform
  // matrix. Degrees. Pitch is intentionally not gated (unreliable from a single
  // frontal 2D image), so its fields stay wide.
  pose: {
    yawPass: 15,
    yawFail: 22,
    pitchPass: 12,
    pitchFail: 30,
    rollPass: 10,
    rollFail: 15,
  },
  // Laplacian variance over the FACE box of the grayscale canvas (not the whole
  // frame — soft backgrounds dilute it). Below `fail` = unusably soft; below
  // `warn` = noticeably soft.
  // quality-1.2.0 recalibration: the v1.1 lines (40/100) false-rejected normal
  // indoor phone photos — a real user pair measured 39.1 (natural, in-focus)
  // vs 108.4 (AI-smoothed skin). Absolute variance is texture- and
  // light-dependent, so the lines sit at the bottom of the natural-photo
  // range instead: measured blur ladder (canvas blur on real photos) drops
  // in-focus 39–108 → 4.9–9.7 at 1px and ≤2.9 at 1.5px, so fail=8 / warn=20
  // rejects ≥1px softness while keeping natural photos. Small sample —
  // TODO(phase0): widen the calibration set.
  blur: {
    fail: 8,
    warn: 20,
  },
  // Fraction of pixels clipped at the highlight / shadow extremes.
  exposure: {
    highlightClipLevel: 250,
    shadowClipLevel: 5,
    fail: 0.3,
    warn: 0.15,
  },
  // Face bounding-box smaller than this (px, on the ≤1280 canvas) → the crop is
  // too low-res for reliable proportions.
  minFaceWidthPx: 120,
  // quality-1.3.0: expression grades come from MediaPipe blendshapes (52
  // coefficients emitted with every detect — zero extra download). Thresholds
  // are on blendshape scores (0..1). Soft check — warns, never rejects:
  // an exaggerated expression distorts measurements, but rejecting on it
  // would false-reject candid photos until calibrated.
  expression: {
    jawOpen: 0.35,
    smile: 0.35,
    browDown: 0.4,
    cheekPuff: 0.35,
    mouthPucker: 0.4,
  },
} as const;

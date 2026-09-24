// Face-shape ESTIMATE — a descriptive label, never a score input.
// Pure geometry heuristic over three already-computed ratios (rules doc v2
// §7). Deliberately isolated from the composite: scorePhoto and the V3
// aggregation path never read this module, and the result page renders it as an
// advisory chip.
// Types are separate from Dimension on purpose.

export type FaceShape = 'oval' | 'round' | 'square' | 'heart' | 'oblong';

export interface FaceShapeRatios {
  /** C1: face height / bizygomatic width. */
  heightWidth: number;
  /** C3: jaw width / bizygomatic width. */
  jawCheek: number;
  /** C2: temple width / bizygomatic width. */
  templeCheek: number;
}

// Cut lines sit inside the C1/C3/C2 zero-failure envelope so the label only
// fires on measurements the scorer itself considers usable.
export const FACE_SHAPE_CUTS = {
  oblongAt: 1.45,
  heartAt: 0.63,
  squareJawAt: 0.9,
  squareTempleAt: 0.55,
  roundHeightAt: 1.22,
  roundJawAt: 0.72,
} as const;

/** null = inputs unusable; the caller degrades to `undetermined`. */
export function classifyFaceShape(r: FaceShapeRatios): FaceShape | null {
  const { heightWidth: h, jawCheek: j, templeCheek: t } = r;
  if (![h, j, t].every((x) => Number.isFinite(x))) return null;
  if (h >= FACE_SHAPE_CUTS.oblongAt) return 'oblong';
  if (j <= FACE_SHAPE_CUTS.heartAt) return 'heart';
  if (j >= FACE_SHAPE_CUTS.squareJawAt && t >= FACE_SHAPE_CUTS.squareTempleAt)
    return 'square';
  if (h <= FACE_SHAPE_CUTS.roundHeightAt && j >= FACE_SHAPE_CUTS.roundJawAt)
    return 'round';
  return 'oval';
}

export interface FaceShapeLabel {
  estimate: FaceShape | 'undetermined';
  /** False when the photo's own ratios are unusable. */
  consistent: boolean;
}

/** The label only exists when the single photo yields a classifiable shape. */
export function faceShapeLabel(a: FaceShape | null): FaceShapeLabel {
  if (a) return { estimate: a, consistent: true };
  return { estimate: 'undetermined', consistent: false };
}

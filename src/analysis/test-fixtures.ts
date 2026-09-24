// Synthetic frontal-face landmark fixture for rule tests — geometry chosen so
// every rule lands INSIDE its full band (rawTotal = 100). Index semantics
// follow MediaPipe Face Landmarker; only scoring points get real coordinates,
// the rest are harmless [0,0] (scoring never reads them).
//
// v2.1 frame summary (pixel space, 400×400): W = dist(234,454) = 160,
// H = dist(10,152) = 220, eye line y = 160, pupil line y = 158 (theta = 0),
// midline x = 200. Eye boxes: canthi 33(outer)/133(inner) and 362(inner)/
// 263(outer) — the true MediaPipe semantics, intercanthal = dist(133,362) = 40
// — with lids 159/145 and 386/374; nose 168→1→4 with alars 98/327 at the
// inner-canthal verticals (alar width ≈ intercanthal, anthropometric norm);
// lips 12/0/15/17, corners 61/291.

import type { Pt } from './score-rules';

export const FIXTURE_SIZE = 400;

export function baseFace(): Pt[] {
  const pts: Pt[] = Array.from({ length: 478 }, () => [0, 0] as Pt);
  const set = (i: number, x: number, y: number) => (pts[i] = [x, y]);

  set(10, 200, 80); // forehead top
  set(152, 200, 300); // chin
  set(234, 120, 220); // cheek L (image left)
  set(454, 280, 220); // cheek R
  set(172, 145, 270); // jaw L
  set(397, 255, 270); // jaw R
  set(67, 155, 120); // temple L
  set(297, 245, 120); // temple R
  set(33, 142, 160); // eye L outer canthus
  set(133, 180, 160); // eye L inner canthus
  set(362, 220, 160); // eye R inner canthus
  set(263, 258, 160); // eye R outer canthus
  set(159, 161, 150); // eye L upper lid
  set(145, 161, 163); // eye L lower lid
  set(386, 239, 150); // eye R upper lid
  set(374, 239, 163); // eye R lower lid
  set(4, 200, 200); // nose tip
  set(168, 200, 175); // nose bridge top
  set(1, 200, 232); // nose base
  set(98, 180, 205); // alar crease L (under eye L inner canthus)
  set(327, 220, 205); // alar crease R (under eye R inner canthus)
  set(61, 170, 240); // mouth corner L
  set(291, 230, 240); // mouth corner R
  set(12, 200, 225); // upper lip top
  set(0, 200, 231); // upper lip bottom (vermilion line)
  set(15, 200, 237); // lower lip top
  set(17, 200, 245); // lower lip bottom
  set(468, 161, 158); // iris L centre
  set(473, 239, 158); // iris R centre
  return pts;
}

export function withPoint(pts: Pt[], idx: number, p: Pt): Pt[] {
  const next = pts.map((q) => [...q] as Pt);
  next[idx] = p;
  return next;
}

// --- transforms used by the invariance tests -------------------------------

export function scaleFace(pts: Pt[], k: number): Pt[] {
  return pts.map(([x, y]) => [x * k, y * k] as Pt);
}

export function mirrorFace(pts: Pt[], width = FIXTURE_SIZE): Pt[] {
  return pts.map(([x, y]) => [width - x, y] as Pt);
}

export function rotateFace(pts: Pt[], deg: number, cx = 200, cy = 200): Pt[] {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cos * dx - sin * dy + cx, sin * dx + cos * dy + cy] as Pt;
  });
}

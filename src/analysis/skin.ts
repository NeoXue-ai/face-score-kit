import type { Detection } from './landmarks';

// skin-signals-1.0.0 — pure pixel signals for a descriptive skin-quality
// reference score. Same honesty contract as quality.ts: these are OUR OWN
// image-signal computations (gradient statistics / chroma spread / highlight
// ratio on skin-classified pixels) — NOT "AI detection", not a dermatological
// assessment, and never an input to the aesthetic score.
//
// Signal design:
//   1. Relative texture  — gradient energy on skin pixels vs an eye-region
//      anchor. The anchor (eyelashes/eyelid edges are always high-frequency)
//      separates "smooth skin" from "blurry photo": if the anchor itself is
//      low, the photo is too soft to grade (status: low_signal).
//   2. Evenness          — a*/b* spread (CIE Lab) on skin pixels: redness /
//      blotchiness proxy.
//   3. Shine             — fraction of very bright skin pixels (oil sheen).
//
// Skin pixels inside each ROI are classified with a classic YCbCr rule, so
// hair strands / eyebrows / glasses inside the ROI do not pollute the stats.
// Forehead ROI skin coverage doubles as an honest "hair covering forehead"
// signal (coverage.foreheadUsable).

export const SKIN_VERSION = 'skin-signals-1.0.0' as const;

// --- probe-calibrated constants (v1: initial values, 2026-09-24; recalibrate
// with more real photos before treating any of these as norms) ---------------
export const SKIN_THRESHOLDS = {
  // Eye-anchor gradient mean below this = photo too soft to grade skin.
  eyeAnchorMin: 6,
  // Relative-texture band (skin gradient / anchor gradient): lower is finer.
  // textureHi 1.2: a clean synthetic ±2-noise field already sits at ~1.0, so
  // anything tighter would floor real photos; probe-recalibrate (n2 follow-up).
  textureLo: 0.15,
  textureHi: 1.2,
  // Lab a*/b* spread band: lower is more even.
  evennessLo: 2.5,
  evennessHi: 9,
  // Shine fraction band: lower is better (a little sheen is normal).
  // Probe-calibrated 2026-09-24 on 6 real portraits: ROI gray p99 ≈ 192-214,
  // max ≈ 200-228; specular sheen first registers above ~215 gray. The old
  // 232 level never fired on any real photo -> band pegged at 100%.
  shineLo: 0.001,
  shineHi: 0.03,
  // ROI needs this fraction of skin-classified pixels to trust its stats.
  roiSkinMin: 0.55,
  // Brightness (0-255) above which an ROI pixel counts as shine.
  shineLevel: 215,
  // Signal weights within the composite.
  weightTexture: 0.5,
  weightEvenness: 0.3,
  weightShine: 0.2,
} as const;

const T = SKIN_THRESHOLDS;

export interface SkinSignals {
  /** skin gradient / eye-anchor gradient; lower = finer texture */
  textureRel: number;
  /** CIE Lab a-star / b-star joint std on skin pixels; lower = more even */
  evenness: number;
  /** fraction of skin pixels above the shine level */
  shine: number;
}

export interface SkinCoverage {
  /** skin-classified fraction inside cheek ROIs */
  cheekSkinRatio: number;
  /** forehead ROI had enough skin pixels to be included */
  foreheadUsable: boolean;
  /** total skin pixels sampled across all ROIs */
  sampleCount: number;
}

export interface SkinAnalysis {
  version: typeof SKIN_VERSION;
  status: 'estimated' | 'low_signal';
  /** 0-10, one decimal; present only when status is 'estimated' */
  display?: number;
  /** 0-100 raw composite; present only when status is 'estimated' */
  raw?: number;
  signals?: SkinSignals;
  coverage?: SkinCoverage;
  /** machine-readable why-not when status is 'low_signal' */
  reasons?: string[];
}

// --- pure pixel helpers (no DOM — unit-testable in Node) --------------------

export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export function isSkinPixel(r: number, g: number, b: number): boolean {
  // Classic YCbCr skin range (Chai & Ngan) + a basic RGB sanity cone.
  if (r <= 95 || g <= 40 || b <= 20 || r > 250 || b > r) return false;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 15 || Math.abs(r - g) < 15) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

export function rgbToLab(r: number, g: number, b: number): { a: number; b: number } {
  // sRGB -> CIE Lab (D65). Only a*/b* are needed downstream.
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

interface RoiAccum {
  skin: number;
  total: number;
  gradSum: number;
  gradCount: number;
  ab: { a: number; b: number }[];
  shine: number;
}

function newAccum(): RoiAccum {
  return { skin: 0, total: 0, gradSum: 0, gradCount: 0, ab: [], shine: 0 };
}

function accumulateRoi(
  src: PixelSource,
  cx: number,
  cy: number,
  r: number,
  acc: RoiAccum,
  opts?: { skinFilter?: boolean }
): void {
  const skinFilter = opts?.skinFilter ?? true;
  const { data, width: w, height: h } = src;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const grayAt = (x: number, y: number) => {
    const [r, g, b] = at(x, y);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const y0 = Math.max(1, Math.round(cy - r));
  const y1 = Math.min(h - 2, Math.round(cy + r));
  const x0 = Math.max(1, Math.round(cx - r));
  const x1 = Math.min(w - 2, Math.round(cx + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      acc.total++;
      const [R, G, B] = at(x, y);
      if (skinFilter && !isSkinPixel(R, G, B)) continue;
      acc.skin++;
      // Central-difference gradient; when skin-filtering, require the
      // neighbors to also be skin so a hair strand crossing the ROI doesn't
      // inflate the texture stat. The eye anchor skips the filter entirely:
      // lashes/eye whites are never "skin" but are exactly the high-frequency
      // detail the anchor must see.
      const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      const nbOk = skinFilter
        ? nb.filter(([r2, g2, b2]) => isSkinPixel(r2, g2, b2)).length
        : 4;
      if (nbOk >= 3) {
        const gx = grayAt(x + 1, y) - grayAt(x - 1, y);
        const gy = grayAt(x, y + 1) - grayAt(x, y - 1);
        acc.gradSum += Math.abs(gx) + Math.abs(gy);
        acc.gradCount++;
      }
      acc.ab.push(rgbToLab(R, G, B));
      // Shine counts over ALL ROI pixels (not just skin-classified): real
      // specular/oil highlights are near-white and fail isSkinPixel's low-
      // saturation cone, so filtering first always yields ~0 -> band pegged
      // at 100% for everyone. Bright non-skin pixels (overexposed background
      // caught at the ROI rim) are the accepted false-positive cost.
      const gray = 0.299 * R + 0.587 * G + 0.114 * B;
      if (gray >= T.shineLevel) acc.shine++;
    }
  }
}

function finalizeRoi(acc: RoiAccum): {
  gradMean: number;
  labSpread: number;
  shineRatio: number;
  skinRatio: number;
  samples: number;
} | null {
  if (acc.gradCount < 30 || acc.skin < 50) return null;
  const n = acc.ab.length;
  let ma = 0, mb = 0;
  for (const { a, b } of acc.ab) { ma += a; mb += b; }
  ma /= n; mb /= n;
  let va = 0, vb = 0;
  for (const { a, b } of acc.ab) { va += (a - ma) ** 2; vb += (b - mb) ** 2; }
  va /= n; vb /= n;
  return {
    gradMean: acc.gradSum / acc.gradCount,
    labSpread: Math.sqrt(va + vb),
    // denominator = all ROI pixels (shine is counted pre-skin-filter)
    shineRatio: acc.shine / acc.total,
    skinRatio: acc.skin / acc.total,
    samples: acc.skin,
  };
}

function circularMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Pure scorer: signals -> raw (0-100) + display (0-10, one decimal). */
export function skinSignalBands(signals: SkinSignals): {
  texture: number;
  evenness: number;
  shine: number;
} {
  const band = (v: number, lo: number, hi: number) =>
    Math.min(1, Math.max(0, 1 - (v - lo) / (hi - lo)));
  return {
    texture: band(signals.textureRel, T.textureLo, T.textureHi),
    evenness: band(signals.evenness, T.evennessLo, T.evennessHi),
    shine: band(signals.shine, T.shineLo, T.shineHi),
  };
}

export function mapSkinDisplay(signals: SkinSignals): { raw: number; display: number } {
  const { texture, evenness, shine } = skinSignalBands(signals);
  const raw = 100 * (T.weightTexture * texture + T.weightEvenness * evenness + T.weightShine * shine);
  return { raw, display: Math.round(raw) / 10 };
}

// --- browser glue ------------------------------------------------------------

const SKIN_LM = {
  foreheadTop: 10,
  glabella: 9,
  leftCheek: 50,
  rightCheek: 280,
  jawLeft: 172,
  jawRight: 397,
  eyeRing: [33, 133, 362, 263],
} as const;

export function sampleSkinFromDetection(
  detection: Detection
): { signals: SkinSignals; coverage: SkinCoverage; eyeAnchor: number } | null {
  const { landmarks, width, height, canvas } = detection;
  if (!landmarks) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, width, height);
  const src: PixelSource = { data, width, height };

  const jawW = Math.hypot(
    landmarks[SKIN_LM.jawLeft][0] - landmarks[SKIN_LM.jawRight][0],
    landmarks[SKIN_LM.jawLeft][1] - landmarks[SKIN_LM.jawRight][1]
  );
  if (!(jawW > 0)) return null;
  const cheekR = jawW / 6;
  const foreheadCx =
    (landmarks[SKIN_LM.foreheadTop][0] + landmarks[SKIN_LM.glabella][0]) / 2;
  const foreheadCy =
    (landmarks[SKIN_LM.foreheadTop][1] + landmarks[SKIN_LM.glabella][1]) / 2;

  const lCheek = newAccum(), rCheek = newAccum(), forehead = newAccum();
  accumulateRoi(src, landmarks[SKIN_LM.leftCheek][0], landmarks[SKIN_LM.leftCheek][1], cheekR, lCheek);
  accumulateRoi(src, landmarks[SKIN_LM.rightCheek][0], landmarks[SKIN_LM.rightCheek][1], cheekR, rCheek);
  accumulateRoi(src, foreheadCx, foreheadCy, jawW / 5, forehead);

  const lRoi = finalizeRoi(lCheek), rRoi = finalizeRoi(rCheek), fRoi = finalizeRoi(forehead);
  if (!lRoi && !rRoi) return null;

  const rois = [lRoi, rRoi, fRoi].filter((v): v is NonNullable<typeof v> => v !== null);
  const gradMean = circularMean(rois.map((v) => v.gradMean));
  const labSpread = circularMean(rois.map((v) => v.labSpread));
  const shineRatio = circularMean(rois.map((v) => v.shineRatio));
  const cheekSkinRatio = circularMean(
    [lRoi, rRoi].filter((v): v is NonNullable<typeof v> => v !== null).map((v) => v.skinRatio)
  );

  // Eye-region anchor: high-frequency detail that exists in every sharp photo.
  const eyeR = jawW / 8;
  const eyeAcc = newAccum();
  for (const idx of SKIN_LM.eyeRing)
    accumulateRoi(src, landmarks[idx][0], landmarks[idx][1], eyeR, eyeAcc, { skinFilter: false });
  const eyeRoi = finalizeRoi(eyeAcc);
  const eyeAnchor = eyeRoi ? eyeRoi.gradMean : 0;

  return {
    signals: { textureRel: eyeAnchor > 0 ? gradMean / eyeAnchor : 0, evenness: labSpread, shine: shineRatio },
    coverage: {
      cheekSkinRatio,
      foreheadUsable: fRoi !== null && fRoi.skinRatio >= T.roiSkinMin,
      sampleCount: rois.reduce((s, v) => s + v.samples, 0),
    },
    eyeAnchor,
  };
}

export function analyzeSkin(detection: Detection): SkinAnalysis {
  const sampled = sampleSkinFromDetection(detection);
  if (!sampled) {
    return { version: SKIN_VERSION, status: 'low_signal', reasons: ['no_roi'] };
  }
  const { signals, coverage, eyeAnchor } = sampled;
  if (eyeAnchor < T.eyeAnchorMin) {
    return {
      version: SKIN_VERSION,
      status: 'low_signal',
      signals,
      coverage,
      reasons: ['photo_too_soft'],
    };
  }
  const { raw, display } = mapSkinDisplay(signals);
  return { version: SKIN_VERSION, status: 'estimated', display, raw, signals, coverage };
}

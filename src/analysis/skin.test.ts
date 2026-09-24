import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SKIN_THRESHOLDS,
  isSkinPixel,
  mapSkinDisplay,
  rgbToLab,
  type PixelSource,
} from './skin';

// Deterministic PRNG so fixtures are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 200;
const H = 200;

// ROI circles used by the fixture landmarks (cheeks r=15 at (70,110)/(130,110),
// forehead r=18 at (100,60)) — kept in sync with the sparse landmark table.
const SKIN_CIRCLES: Array<[number, number, number]> = [
  [70, 110, 15],
  [130, 110, 15],
  [100, 60, 18],
];
const SHINE_RGB: [number, number, number] = [250, 232, 214]; // bright but still skin-classified
const BASE_RGB: [number, number, number] = [210, 160, 130];

/**
 * Base image: matte skin tone + tiny global noise (sharp enough for the eye
 * anchor). Optionally add strong noise / shine INSIDE the skin ROI circles
 * only, so skin-signal deltas are not cancelled by the anchor moving too.
 */
function makeSource(opts?: { skinNoise?: number; skinShine?: boolean }): PixelSource {
  const rng = mulberry32(42);
  const inCircle = (x: number, y: number) =>
    SKIN_CIRCLES.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let [r, g, b] = BASE_RGB;
      const n = (rng() - 0.5) * 2 * 2; // global ±2 keeps the anchor sharp
      r += n; g += n; b += n;
      if (inCircle(x, y)) {
        if (opts?.skinShine) {
          [r, g, b] = SHINE_RGB;
        } else if (opts?.skinNoise) {
          const nz = (rng() - 0.5) * 2 * opts.skinNoise;
          r = 210 + nz; g = 160 + nz; b = 130 + nz;
        }
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

describe('isSkinPixel', () => {
  it('accepts typical skin tones', () => {
    assert.equal(isSkinPixel(220, 170, 140), true);
    assert.equal(isSkinPixel(180, 130, 105), true);
  });
  it('rejects hair, walls, and background tones', () => {
    assert.equal(isSkinPixel(40, 30, 25), false); // dark hair
    assert.equal(isSkinPixel(245, 245, 245), false); // white wall
    assert.equal(isSkinPixel(30, 80, 200), false); // blue background
  });
});

describe('rgbToLab', () => {
  it('gives neutral a*/b* for a neutral gray', () => {
    const { a, b } = rgbToLab(128, 128, 128);
    assert.ok(Math.abs(a) < 1.5, `a=${a}`);
    assert.ok(Math.abs(b) < 1.5, `b=${b}`);
  });
  it('gives positive b* for warm skin tone', () => {
    const { b } = rgbToLab(210, 160, 130);
    assert.ok(b > 5, `b=${b}`);
  });
});

describe('mapSkinDisplay', () => {
  it('scores ideal signals near the top of the scale', () => {
    const { raw, display } = mapSkinDisplay({ textureRel: 0.1, evenness: 2, shine: 0.005 });
    assert.ok(raw > 90, `raw=${raw}`);
    assert.ok(display > 9);
  });
  it('scores poor signals near the bottom', () => {
    const { raw } = mapSkinDisplay({ textureRel: 1.0, evenness: 12, shine: 0.2 });
    assert.ok(raw < 15, `raw=${raw}`);
  });
  it('keeps display on the 0-10 one-decimal grid', () => {
    const { display } = mapSkinDisplay({ textureRel: 0.4, evenness: 5, shine: 0.05 });
    assert.ok(display >= 0 && display <= 10);
    assert.equal(Math.round(display * 10), display * 10);
  });
});

describe('skin signal direction (smooth vs noisy vs shine)', () => {
  it('smooth skin yields higher raw than noisy skin', async () => {
    const { sampleSkinFromDetection } = await import('./skin');
    // Sparse landmark table keyed by real MediaPipe indices (SKIN_LM set:
    // 10 forehead, 9 glabella, 50/280 cheeks, 172/397 jaw, 33/133/362/263 eye ring).
    const makeDetection = (src: PixelSource) => {
      const table: Record<number, [number, number]> = {
        10: [100, 40], 9: [100, 80], 50: [70, 110], 280: [130, 110],
        172: [55, 130], 397: [145, 130],
        33: [75, 90], 133: [95, 90], 362: [105, 90], 263: [125, 90],
      };
      const landmarks = [] as [number, number][];
      for (const [k, v] of Object.entries(table)) landmarks[+k] = v;
      return {
        faceCount: 1 as const,
        landmarks,
        width: W,
        height: H,
        blendshapes: null,
        canvas: { getContext: () => ({ getImageData: () => ({ data: src.data }) }) } as unknown as HTMLCanvasElement,
      };
    };
    const smooth = sampleSkinFromDetection(makeDetection(makeSource()));
    const noisy = sampleSkinFromDetection(makeDetection(makeSource({ skinNoise: 22 })));
    assert.ok(smooth && noisy);
    assert.ok(smooth.eyeAnchor > 0);
    assert.ok(smooth.signals.evenness < noisy.signals.evenness, 'smooth should be more even');
    const sSmooth = mapSkinDisplay(smooth.signals);
    const sNoisy = mapSkinDisplay(noisy.signals);
    assert.ok(sSmooth.raw > sNoisy.raw, `smooth ${sSmooth.raw} should beat noisy ${sNoisy.raw}`);
  });
  it('shine pixels register in the shine signal', async () => {
    const { sampleSkinFromDetection } = await import('./skin');
    const makeDetection = (src: PixelSource) => {
      const table: Record<number, [number, number]> = {
        10: [100, 40], 9: [100, 80], 50: [70, 110], 280: [130, 110],
        172: [55, 130], 397: [145, 130],
        33: [75, 90], 133: [95, 90], 362: [105, 90], 263: [125, 90],
      };
      const landmarks = [] as [number, number][];
      for (const [k, v] of Object.entries(table)) landmarks[+k] = v;
      return {
        faceCount: 1 as const,
        landmarks,
        width: W,
        height: H,
        blendshapes: null,
        canvas: { getContext: () => ({ getImageData: () => ({ data: src.data }) }) } as unknown as HTMLCanvasElement,
      };
    };
    const matte = sampleSkinFromDetection(makeDetection(makeSource()));
    const shiny = sampleSkinFromDetection(makeDetection(makeSource({ skinShine: true })));
    assert.ok(matte && shiny);
    assert.ok(shiny.signals.shine > matte.signals.shine, `shine ${shiny.signals.shine} vs ${matte.signals.shine}`);
  });
});

describe('thresholds sanity', () => {
  it('keeps weights summing to 1 and bands ordered', () => {
    const t = SKIN_THRESHOLDS;
    assert.equal(t.weightTexture + t.weightEvenness + t.weightShine, 1);
    assert.ok(t.textureLo < t.textureHi);
    assert.ok(t.evennessLo < t.evennessHi);
    assert.ok(t.shineLo < t.shineHi);
  });
});

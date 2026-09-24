import type { Detection } from './landmarks';

// demographics-genderage-1.0.0 — browser-local age/gender estimation.
//
// Model: insightface GenderAge ONNX (1.26MB, 96x96 input), fetched from our
// own /models/ directory — no server, no API: inference runs in the tab via
// onnxruntime-web (wasm), same privacy contract as the MediaPipe landmarker.
// The model is factual-recognition (appearance estimation), NOT identity,
// NOT the aesthetic score, and its output is advisory-only: it never enters
// ScoreOutcomeV3, metrics, or recommendations.
//
// Honesty contract (same as the rest of the analysis):
//   - low model margin or implausible age -> status 'uncertain', no value shown
//   - runtime/model failure -> status 'unavailable'
//   - the UI must label this a rough estimate.
//
// Preprocessing (verified against the reference implementation,
// yakhyo/facial-analysis gender_age.py, probe 2026-09-24):
//   face box = bbox(landmarks 10/152/234/454), center + max(w,h)*1.5 crop,
//   resized 96x96, raw RGB 0-255 (NO mean/std normalization), NCHW.
// Decoding: gender = argmax(pred[0:2]) with 0=male 1=female,
//           ageYears = round(pred[2]*100).

import type { InferenceSession } from 'onnxruntime-web';

export const DEMOGRAPHICS_VERSION = 'demographics-genderage-1.0.0' as const;

const MODEL_URL = '/models/genderage.onnx';
export const MODEL_ID = 'insightface-genderage@96' as const;
const INPUT_SIZE = 96;

// Overridable hosting location for the ONNX weights. Defaults to the demo's
// public dir; point it at your own static host before first inference.
export const demographicsConfig: { modelUrl: string } = { modelUrl: MODEL_URL };

// --- thresholds (probe-calibrated v1, 2026-09-24) ---------------------------
export const DEMOGRAPHICS_THRESHOLDS = {
  // |pred[0]-pred[1]| below this -> gender too close to call.
  genderMarginMin: 0.05,
  // Implausible model outputs are treated as failure, not clamped away.
  ageMin: 3,
  ageMax: 95,
} as const;

const T = DEMOGRAPHICS_THRESHOLDS;

export type AgeBand = '<20' | '20-35' | '35-50' | '50+';

export interface DemographicsAnalysis {
  version: typeof DEMOGRAPHICS_VERSION;
  modelId: typeof MODEL_ID;
  status: 'estimated' | 'uncertain' | 'unavailable';
  gender?: 'male' | 'female';
  /** |pred0-pred1|/2, roughly 0..0.5; present for estimated + uncertain */
  genderMargin?: number;
  ageYears?: number;
  ageBand?: AgeBand;
  reasons?: string[];
}

// --- pure decode layer (node-testable) --------------------------------------

export interface GenderAgePrediction {
  gender: 'male' | 'female';
  genderMargin: number;
  ageYears: number;
}

/** Decode the raw [1,3] model output. Throws on non-finite values. */
export function decodeGenderAge(pred: readonly number[]): GenderAgePrediction {
  if (pred.length < 3) throw new Error('genderage output must have 3 values');
  const [p0, p1, a] = pred;
  for (const v of [p0, p1, a]) {
    if (!Number.isFinite(v)) throw new Error('genderage output has non-finite values');
  }
  const gender = p0 >= p1 ? 'male' : 'female';
  return {
    gender,
    genderMargin: Math.abs(p0 - p1) / 2,
    ageYears: Math.round(a * 100),
  };
}

export function ageToBand(ageYears: number): AgeBand {
  if (ageYears < 20) return '<20';
  if (ageYears < 35) return '20-35';
  if (ageYears < 50) return '35-50';
  return '50+';
}

/** Pure admission gate: model output -> estimated/uncertain + reasons. */
export function gradePrediction(pred: GenderAgePrediction): {
  status: 'estimated' | 'uncertain';
  reasons: string[];
} {
  const reasons: string[] = [];
  let uncertain = false;
  if (pred.genderMargin < T.genderMarginMin) {
    reasons.push('gender_low_margin');
    uncertain = true;
  }
  if (pred.ageYears < T.ageMin || pred.ageYears > T.ageMax) {
    reasons.push('age_implausible');
    uncertain = true;
  }
  return { status: uncertain ? 'uncertain' : 'estimated', reasons };
}

// --- browser inference -------------------------------------------------------

let ortModule: typeof import('onnxruntime-web') | null = null;
let session: InferenceSession | null = null;
let pending: Promise<InferenceSession> | null = null;

async function ensureSession(): Promise<InferenceSession> {
  if (session) return session;
  if (!pending) {
    pending = (async () => {
      const ort = await import('onnxruntime-web');
      ortModule = ort;
      // wasm artifacts come from the pinned CDN build (same pattern as the
      // MediaPipe wasm/model assets in landmarks.ts).
      ort.env.wasm.wasmPaths =
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
      const buf = await fetch(demographicsConfig.modelUrl).then((r) => {
        if (!r.ok) throw new Error(`genderage model fetch failed: ${r.status}`);
        return r.arrayBuffer();
      });
      return ort.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
      });
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}

function cropToTensor(
  detection: Detection
): { data: Float32Array; shape: [number, number, number, number] } | null {
  const { landmarks, width, height, canvas } = detection;
  if (!landmarks) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bb = [10, 152, 234, 454].map((i) => landmarks[i]);
  if (bb.some((p) => !p)) return null;
  const x0 = Math.min(...bb.map((p) => p[0]));
  const x1 = Math.max(...bb.map((p) => p[0]));
  const y0 = Math.min(...bb.map((p) => p[1]));
  const y1 = Math.max(...bb.map((p) => p[1]));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cropScale = INPUT_SIZE / (Math.max(x1 - x0, y1 - y0) * 1.5);
  if (!(cropScale > 0) || !Number.isFinite(cropScale)) return null;

  const face = document.createElement('canvas');
  face.width = INPUT_SIZE;
  face.height = INPUT_SIZE;
  const fctx = face.getContext('2d', { willReadFrequently: true });
  if (!fctx) return null;
  // source = (t - outCenter)/cropScale + faceCenter → dest = cropScale*source
  // + (outCenter - cropScale*faceCenter): face center lands on the tensor
  // center, and the 1.5x-face box fills the 96x96 input exactly.
  fctx.setTransform(
    cropScale,
    0,
    0,
    cropScale,
    INPUT_SIZE / 2 - cropScale * cx,
    INPUT_SIZE / 2 - cropScale * cy
  );
  fctx.drawImage(canvas, 0, 0);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  const px = fctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    data[i] = px[i * 4];
    data[plane + i] = px[i * 4 + 1];
    data[2 * plane + i] = px[i * 4 + 2];
  }
  return { data, shape: [1, 3, INPUT_SIZE, INPUT_SIZE] };
}

export async function estimateDemographics(
  detection: Detection
): Promise<DemographicsAnalysis> {
  const base = { version: DEMOGRAPHICS_VERSION, modelId: MODEL_ID } as const;
  try {
    const s = await ensureSession();
    const tensor = cropToTensor(detection);
    if (!tensor) {
      return { ...base, status: 'unavailable', reasons: ['no_landmarks'] };
    }
    const ort = ortModule ?? (await import('onnxruntime-web'));
    const inputName = s.inputNames[0];
    const output = await s.run({
      [inputName]: new ort.Tensor('float32', tensor.data, tensor.shape),
    });
    const raw = output[s.outputNames[0]];
    const values = Array.from(raw.data as Float32Array);
    const pred = decodeGenderAge(values);
    const graded = gradePrediction(pred);
    return {
      ...base,
      status: graded.status,
      gender: pred.gender,
      genderMargin: pred.genderMargin,
      ageYears: pred.ageYears,
      ageBand: ageToBand(pred.ageYears),
      reasons: graded.reasons,
    };
  } catch {
    return {
      ...base,
      status: 'unavailable',
      reasons: ['model_or_runtime_failed'],
    };
  }
}

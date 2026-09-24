import type { FaceLandmarker as FaceLandmarkerClass } from "@mediapipe/tasks-vision"

// MediaPipe touches `self`/`window` at module-eval time, so the runtime classes
// are loaded lazily inside browser-only code paths (dynamic import) rather than
// at SSR import time. Only the type is statically imported (erased at build).

// Version-pinned CDN assets. Stage 3 may parameterize if we swap the model.
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

// Longest-edge cap for the analyzed canvas. Face shape and proportions are
// computed from normalized landmark ratios, so downscaling is lossless for them
// and keeps the base64 handed to sessionStorage well under the ~5 MB quota.
export const MAX_ANALYZE_DIM = 1280

export type LandmarkFailureCode =
  | "gpu_cpu_unavailable"
  | "model_download_failed"

export class AnalysisError extends Error {
  code: LandmarkFailureCode
  constructor(code: LandmarkFailureCode, message?: string) {
    super(message ?? code)
    this.name = "AnalysisError"
    this.code = code
  }
}

export interface Detection {
  faceCount: number
  // Pixel-space landmarks ([x,y]) for the primary face, on the returned canvas.
  landmarks: [number, number][] | null
  // 52 MediaPipe blendshape coefficients for the primary face (quality-1.3.0
  // expression grading). Null when the runtime did not emit them.
  blendshapes: { categoryName: string; score: number }[] | null
  width: number
  height: number
  canvas: HTMLCanvasElement
}

let instance: FaceLandmarkerClass | null = null
let pending: Promise<FaceLandmarkerClass> | null = null
let failureCode: LandmarkFailureCode | null = null

async function buildWithDelegate(
  delegate: "GPU" | "CPU"
): Promise<FaceLandmarkerClass> {
  const { FaceLandmarker, FilesetResolver } = await import(
    "@mediapipe/tasks-vision"
  )
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    // quality-1.3.0: blendshapes ride along with the same detect() call —
    // no extra model download — and drive the expression quality grade.
    outputFaceBlendshapes: true,
    runningMode: "IMAGE", // static-image semantics (was wrongly VIDEO)
    numFaces: 1,
  })
}

// On-demand, cached. GPU then CPU, so a machine without a working WebGL/WebGPU
// path still succeeds instead of "page loads, analysis always fails" (FR-03).
export function getLandmarker(): Promise<FaceLandmarkerClass> {
  if (instance) return Promise.resolve(instance)
  if (failureCode) return Promise.reject(new AnalysisError(failureCode))
  if (!pending) {
    pending = (async () => {
      let lastErr: unknown
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          const created = await buildWithDelegate(delegate)
          instance = created
          return created
        } catch (err) {
          lastErr = err
        }
      }
      failureCode =
        lastErr instanceof Error && /fetch|network|download/i.test(lastErr.message)
          ? "model_download_failed"
          : "gpu_cpu_unavailable"
      throw new AnalysisError(failureCode, String(lastErr ?? "delegate init failed"))
    })().finally(() => {
      pending = null
    })
  }
  return pending
}

export function releaseLandmarker(): void {
  instance?.close()
  instance = null
  pending = null
  failureCode = null
}

function loadImageFile(
  file: File
): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, objectUrl })
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Failed to load image"))
    }
    img.src = objectUrl
  })
}

// Single-image detection: decode → downscale → draw to canvas → IMAGE detect.
// Reuses one cached landmarker across photos (multi-photo capture, spec 04).
export async function detectFromFile(file: File): Promise<Detection> {
  const landmarker = await getLandmarker()
  const { img, objectUrl } = await loadImageFile(file)

  let w = img.naturalWidth
  let h = img.naturalHeight
  const scale = Math.min(1, MAX_ANALYZE_DIM / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale))
  h = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new AnalysisError("gpu_cpu_unavailable", "canvas 2d unavailable")
  ctx.drawImage(img, 0, 0, w, h)
  URL.revokeObjectURL(objectUrl)

  const res = landmarker.detect(canvas)
  const faces = res.faceLandmarks ?? []
  const landmarks =
    faces.length > 0
      ? faces[0].map(
          (lm) => [Math.round(lm.x * w), Math.round(lm.y * h)] as [number, number]
        )
      : null
  const blendshapes = faces.length > 0 ? (res.faceBlendshapes?.[0]?.categories ?? null) : null

  return { faceCount: faces.length, landmarks, blendshapes, width: w, height: h, canvas }
}

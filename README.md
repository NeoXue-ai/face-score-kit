# face-score-kit

**A fully client-side face analysis toolkit.** One front photo in the browser →
rule-based aesthetic reference score, pixel-statistics skin signals, local-model
age/gender estimate, face-shape classification, annotated landmark overlay.

**Nothing ever leaves the tab.** No upload, no server API, no analytics, no
persistence beyond what the caller chooses to do with the returned object.
All models (MediaPipe Face Landmarker, insightface GenderAge ONNX) run locally
via WebAssembly.

中文简介：一个纯前端的颜值分析工具包 —— 单张正脸照片在浏览器本地完成：规则审美参考分、
皮肤像素信号（纹理/均匀/油光）、本地小模型性别与年龄段估计、脸型分类、关键点叠加图。
照片不上传、无服务器调用、无追踪。分数是产品参考约定，不是医学或客观审美判断。

---

## How it works

```
File ──▶ MediaPipe FaceLandmarker (478 landmarks + 52 blendshapes)
          │
          ├─▶ quality gate (pose / blur / exposure / occlusion / size)
          │      └─ fail ⇒ no_score — the report NEVER shows a number
          │
          ├─▶ rule scoring  (12 rules × 6 dimensions, pure geometry)
          │      └─ raw 0-100 → population-normalized display 0-10
          │
          ├─▶ advisory: skin signals  (YCbCr skin filter, gradient / Lab a*b* / sheen)
          ├─▶ advisory: age + gender  (local ONNX, confidence-gated)
          └─▶ face shape  (H/W, jaw/cheek, temple/cheek ratios)
```

Design contract (enforced by runtime validators in `analysis-schema.ts`):

- a `no_score` outcome can never carry a composite score
- `low_signal` / `uncertain` / `unavailable` advisory blocks can never carry values
- every report embeds a bilingual "limitations" disclosure

## Quick start (demo)

```bash
npm install
npm run dev        # http://localhost:5173
```

Pick a clear front-facing photo (full forehead, no glasses, no beauty filters),
confirm adult, hit Analyze. First run downloads ~10 MB of wasm/models from CDN
into the browser cache; after that everything is offline.

## Use as a library

```ts
import { runAnalysisV3, isRunV3Failure } from 'face-score-kit';

const result = await runAnalysisV3(
  { role: 'front', file },          // File from <input type="file">
  { adultConfirmed: true }
);

if (!isRunV3Failure(result)) {
  const a = result.analysis;        // AnalysisV3 — plain JSON-able object
  if (a.score.status === 'scored') {
    console.log(a.score.compositeScore);        // 0-10, one decimal
    console.log(a.score.dimensionDisplay);      // per-dimension 0-10
    console.log(a.skinQuality?.display);        // advisory skin reference
    console.log(a.demographics?.ageBand);       // advisory '<20'|'20-35'|'35-50'|'50+'
  }
  document.img.src = a.photos[0].annotatedRef;  // annotated landmark overlay (data URL)
}
```

Lower-level pieces are exported too: `scorePhoto` (pure geometry → raw rule
scores, runs in Node), `analyzeSkin`, `estimateDemographics`,
`decodeGenderAge`, `skinSignalBands`, `classifyFaceShape`, `renderOverlay`,
plus all thresholds as constants.

Self-host the genderage weights instead of the demo's `/models/` path:

```ts
import { demographicsConfig } from 'face-score-kit';
demographicsConfig.modelUrl = 'https://your.cdn/genderage.onnx';
```

## API sketch

| Export | Kind | What it does |
| --- | --- | --- |
| `runAnalysisV3(photo, opts)` | async | Full pipeline: detect → gate → score → advisory |
| `detectFromFile(file)` | async | File → downscaled canvas + landmarks + blendshapes |
| `scorablePhoto(det, verdict)` | sync | Strict admission gate (any warn ⇒ not scorable) |
| `scorePhoto(role, landmarks, size)` | sync | Pure rule scoring (no DOM — unit-testable in Node) |
| `assessQuality(det)` | sync | Soft quality verdict with per-check grades |
| `analyzeSkin(det)` | sync | Texture / evenness / sheen pixel signals |
| `estimateDemographics(det)` | async | Local ONNX age/gender, margin-gated |
| `renderOverlay(canvas, ctx, lms)` | sync | Annotated overlay as JPEG data URL |

## Scoring model (read before trusting it)

- The composite is a **rule-based aesthetic reference index**, normal-calibrated
  against a synthetic population so most faces land between 5 and 7. It is a
  product convention anchored to common anthropometric ranges — **not** measured
  population norms, a percentile, or a prediction of how anyone rates you.
- Photo conditions dominate the error bars: focus, depth of field, lighting,
  distance, resolution and beauty filters all move the numbers. Compare faces
  across different photos at your own risk; same-photo repeat measurement is
  deterministic.
- Skin signals and age/gender are **advisory only** and are structurally
  prevented from entering the score.

## Third-party assets

- [MediaPipe Face Landmarker](https://developers.google.com/mediapipe) — Apache-2.0
- insightface GenderAge ONNX weights — sourced from the insightface ecosystem,
  included for research/personal convenience; check upstream terms before
  commercial deployment.

## Development

```bash
npm test         # node:test suite (74 tests) — pure rules + schema + pipeline
npm run typecheck
npm run build    # tsc → dist/ (ESM + d.ts)
```

License: MIT (see LICENSE for third-party asset notices).

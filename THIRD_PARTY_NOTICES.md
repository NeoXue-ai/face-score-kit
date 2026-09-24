# Third-party notices

The MIT license in [LICENSE](./LICENSE) covers the source code of this project.
The following third-party components and assets are **not** covered by it and
remain under their own terms.

## MediaPipe Face Landmarker

- Component: `@mediapipe/tasks-vision` wasm runtime + `face_landmarker.task` model
- Author: Google LLC (MediaPipe)
- License: Apache License 2.0
- Loaded at runtime from pinned CDN URLs (`landmarks.ts`) — not vendored in this
  repository.
- https://developers.google.com/mediapipe

## insightface GenderAge ONNX weights

- File: `public/models/genderage.onnx` (~1.3 MB, 96×96 input)
- Origin: derived from the insightface model ecosystem
  (reference preprocessing: yakhyo/facial-analysis `gender_age.py`)
- License: **not** explicitly stated by the upstream project. Included here for
  research and personal use. Verify the upstream terms before any commercial
  deployment, and replace the weights with your own if in doubt.

## onnxruntime-web

- Component: `onnxruntime-web` npm package; the wasm artifacts are fetched at
  runtime from a pinned jsDelivr CDN build (`demographics.ts`)
- Author: Microsoft
- License: MIT
- https://onnxruntime.ai
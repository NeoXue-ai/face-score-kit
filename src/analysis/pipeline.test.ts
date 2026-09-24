import assert from 'node:assert/strict';
import test from 'node:test';

import type { QualityChecks, QualityVerdict } from '../analysis-schema';
import type { Detection } from './landmarks';
import { scorablePhoto } from './pipeline';
import type { Pt } from './score-rules';
import { baseFace, FIXTURE_SIZE, scaleFace, withPoint } from './test-fixtures';

// The fixture pads non-scoring points with [0,0]; the face-box gates read all
// landmarks, so tests run against a clean-background variant.
function cleanFace(): Pt[] {
  return baseFace().map((p) =>
    p[0] === 0 && p[1] === 0 ? ([200, 220] as Pt) : p
  );
}

function det(
  landmarks: Pt[] | null,
  faceCount: number = 1,
  size = FIXTURE_SIZE
): Detection {
  return {
    faceCount,
    landmarks: landmarks as [number, number][] | null,
    blendshapes: null,
    width: size,
    height: size,
    canvas: null as unknown as HTMLCanvasElement,
  };
}

function verdict(overrides: Partial<QualityChecks> = {}): QualityVerdict {
  return {
    pass: true,
    checks: {
      faceCount: 1,
      pose: 'pass',
      blur: 'pass',
      exposure: 'pass',
      occlusion: 'pass',
      ...overrides,
    },
    reasons: [],
  };
}

test('scorablePhoto: clean frontal face passes the strict §5 gate', () => {
  const r = scorablePhoto(det(cleanFace()), verdict());
  assert.deepEqual(r, { ok: true, codes: [] });
});

test('scorablePhoto: no face and multiple faces short-circuit to face_count', () => {
  const none = scorablePhoto(det(null, 0), verdict({ faceCount: 0 }));
  assert.equal(none.ok, false);
  assert.deepEqual(none.codes, ['face_count']);

  const many = scorablePhoto(
    det(cleanFace(), 2),
    verdict({ faceCount: 'multiple' })
  );
  assert.deepEqual(many.codes, ['face_count']);
});

test('scorablePhoto: any warn (not just fail) on pose/blur/exposure is rejected', () => {
  for (const check of ['pose', 'blur', 'exposure'] as const) {
    const r = scorablePhoto(det(cleanFace()), verdict({ [check]: 'warn' }));
    assert.equal(r.ok, false, `${check} warn must fail`);
    assert.ok(r.codes.includes('quality_grades'));
    // warn must be the only complaint — the other gates stay clean:
    assert.deepEqual(r.codes, ['quality_grades']);
  }
});

test('scorablePhoto: occlusion warn alone is NOT a scoring rejection (§5 gates 1-5 only)', () => {
  // assessQuality treats occlusion softly; scorablePhoto must not re-check it
  // beyond the edge-clip gate, which is geometry, not the verdict grade.
  const r = scorablePhoto(det(cleanFace()), verdict({ occlusion: 'warn' }));
  assert.equal(r.ok, true);
});

test('scorablePhoto: half-scale face falls below minFaceWidthPx', () => {
  const r = scorablePhoto(det(scaleFace(cleanFace(), 0.5)), verdict());
  assert.ok(r.codes.includes('face_too_small'));
  assert.ok(!r.codes.includes('edge_clipped'));
});

test('scorablePhoto: face touching the frame edge is clipped', () => {
  // Shift everything right so the right cheek crosses the w-2 boundary.
  const shifted = cleanFace().map(([x, y]) => [x + 125, y] as Pt);
  const r = scorablePhoto(det(shifted), verdict());
  assert.ok(r.codes.includes('edge_clipped'));
});

test('scorablePhoto: a scoring point outside the canvas is rejected', () => {
  const broken = withPoint(cleanFace(), 468, [-5, 158]);
  const r = scorablePhoto(det(broken), verdict());
  assert.ok(r.codes.includes('landmarks_out_of_frame'));
});

test('scorablePhoto: a non-finite scoring point is rejected', () => {
  const nan = withPoint(cleanFace(), 473, [Number.NaN, 158]);
  const r = scorablePhoto(det(nan), verdict());
  assert.ok(r.codes.includes('landmarks_out_of_frame'));
});

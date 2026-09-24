// Face-shape heuristic tests (rules doc v2 §7): classification boundaries,
// the single-photo label, and the fixture end-to-end path. The classifier is
// advisory — none of this can move a score.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyFaceShape,
  FACE_SHAPE_CUTS,
  faceShapeLabel,
  type FaceShapeRatios,
} from './face-shape';
import { scorePhoto } from './score-rules';
import { baseFace } from './test-fixtures';

const r = (
  heightWidth: number,
  jawCheek: number,
  templeCheek: number
): FaceShapeRatios => ({ heightWidth, jawCheek, templeCheek });

const { oblongAt, heartAt, squareJawAt, squareTempleAt } = FACE_SHAPE_CUTS;

test('non-finite inputs classify as null, never a guessed label', () => {
  assert.equal(classifyFaceShape(r(Number.NaN, 0.8, 0.6)), null);
  assert.equal(classifyFaceShape(r(1.3, Number.POSITIVE_INFINITY, 0.6)), null);
  assert.equal(classifyFaceShape(r(1.3, 0.8, Number.NaN)), null);
});

test('long faces win first: heightWidth at/above the cut is oblong', () => {
  assert.equal(classifyFaceShape(r(oblongAt, 0.8, 0.6)), 'oblong');
  assert.equal(classifyFaceShape(r(1.8, 0.5, 0.9)), 'oblong'); // beats heart
  assert.equal(
    classifyFaceShape(r(oblongAt - 1e-9, 0.8, 0.6)),
    'oval' // just under the line
  );
});

test('narrow jaw classifies heart, boundary inclusive', () => {
  assert.equal(classifyFaceShape(r(1.3, heartAt, 0.6)), 'heart');
  assert.equal(classifyFaceShape(r(1.3, heartAt - 1e-9, 0.6)), 'heart');
  assert.equal(classifyFaceShape(r(1.3, heartAt + 1e-9, 0.6)), 'oval');
});

test('square needs BOTH a wide jaw and wide temples', () => {
  assert.equal(
    classifyFaceShape(r(1.3, squareJawAt, squareTempleAt)),
    'square'
  );
  assert.equal(
    classifyFaceShape(r(1.3, 0.95, squareTempleAt - 1e-9)),
    'oval' // jaw wide, temples narrow → not square
  );
  assert.equal(
    classifyFaceShape(r(1.3, squareJawAt - 1e-9, 0.8)),
    'oval' // temples wide, jaw below the cut → not square
  );
});

test('round needs a short face and a full jaw', () => {
  assert.equal(classifyFaceShape(r(1.1, 0.8, 0.6)), 'round');
  assert.equal(classifyFaceShape(r(1.3, 0.8, 0.6)), 'oval'); // face too long
  assert.equal(classifyFaceShape(r(1.1, 0.5, 0.6)), 'heart'); // jaw too narrow
});

test('everything else is the oval fallback', () => {
  assert.equal(classifyFaceShape(r(1.3, 0.75, 0.5)), 'oval');
});

test('faceShapeLabel falls back to undetermined when ratios are unusable', () => {
  assert.deepEqual(faceShapeLabel('oval'), {
    estimate: 'oval',
    consistent: true,
  });
  assert.deepEqual(faceShapeLabel('oblong'), {
    estimate: 'oblong',
    consistent: true,
  });
  assert.deepEqual(faceShapeLabel(null), {
    estimate: 'undetermined',
    consistent: false,
  });
});

test('the base fixture feeds oval through the real metric path', () => {
  const result = scorePhoto('fixture', baseFace());
  if (result.status !== 'scored') assert.fail('fixture must score');
  const value = (ruleId: string) =>
    result.score.contributions.find(
      (c) => c.ruleId === ruleId && c.status === 'included'
    )?.metricValue;
  const [h, j, t] = [value('C1'), value('C3'), value('C2')];
  assert.ok(h !== undefined && j !== undefined && t !== undefined);
  assert.equal(
    classifyFaceShape({ heightWidth: h, jawCheek: j, templeCheek: t }),
    'oval'
  );
});

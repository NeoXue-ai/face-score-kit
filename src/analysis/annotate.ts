// Visual-only overlay (no numbers produced here). Kept as a pure function over
// a supplied canvas so it stays SSR-safe — callers create the canvas in
// browser code (spec 06). The source canvas is never mutated: the report image
// is composited onto a 2x offscreen copy.

export function renderOverlay(
  canvas: HTMLCanvasElement,
  _ctx: CanvasRenderingContext2D | null,
  landmarks: [number, number][]
): string {
  const w = canvas.width;
  const h = canvas.height;
  const out = document.createElement('canvas');
  out.width = w * 2;
  out.height = h * 2;
  const g = out.getContext('2d');
  if (!g) return canvas.toDataURL('image/jpeg', 0.82);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  g.scale(2, 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const pt = (i: number): [number, number] | null =>
    i < landmarks.length ? landmarks[i] : null;
  const ink = (indices: number[], close: boolean) => {
    g.beginPath();
    let started = false;
    for (const i of indices) {
      const p = pt(i);
      if (!p) continue;
      if (!started) {
        g.moveTo(p[0], p[1]);
        started = true;
      } else g.lineTo(p[0], p[1]);
    }
    if (started && close) g.closePath();
    g.stroke();
  };

  // Bottom scrim keeps the caption legible on pale skin/white walls.
  const scrim = g.createLinearGradient(0, h * 0.72, 0, h);
  scrim.addColorStop(0, 'rgba(6, 8, 14, 0)');
  scrim.addColorStop(1, 'rgba(6, 8, 14, 0.42)');
  g.fillStyle = scrim;
  g.fillRect(0, h * 0.72, w, h * 0.28);

  // Feature contours: dark pass for contrast on any photo, gold pass with a
  // soft glow on top.
  const contours: [number[], boolean][] = [
    [
      [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
        379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
        127, 162, 21, 54, 103, 67, 109,
      ],
      false,
    ],
    [
      [
        61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267,
        0, 37, 39, 40, 185,
      ],
      true,
    ],
    [[78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402], true],
    [
      [
        33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144,
        163, 7,
      ],
      true,
    ],
    [
      [
        362, 398, 384, 385, 386, 387, 388, 263, 249, 390, 373, 374, 380, 381,
        382,
      ],
      true,
    ],
    [[70, 63, 105, 66, 107, 55, 65, 52, 53, 46], false],
    [[300, 293, 334, 296, 336, 285, 295, 282, 283, 276], false],
    [[168, 6, 197, 195], false],
  ];
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(8, 10, 16, 0.5)';
  g.lineWidth = 2.6;
  for (const [idx, close] of contours) ink(idx, close);
  g.strokeStyle = 'rgba(250, 210, 130, 0.95)';
  g.lineWidth = 1.1;
  g.shadowColor = 'rgba(248, 190, 90, 0.9)';
  g.shadowBlur = 5;
  for (const [idx, close] of contours) ink(idx, close);
  g.shadowBlur = 0;

  // Every sampled point, kept tiny so the mesh reads as data, not noise.
  g.fillStyle = 'rgba(255, 232, 190, 0.68)';
  for (const [x, y] of landmarks) {
    g.beginPath();
    g.arc(x, y, 1.15, 0, 2 * Math.PI);
    g.fill();
  }

  // Measurement anchors: iris rings (468-472 / 473-477), nose tip, chin,
  // forehead midline.
  const centroid = (idx: number[]): [number, number] | null => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const i of idx) {
      const p = pt(i);
      if (!p) continue;
      sx += p[0];
      sy += p[1];
      n++;
    }
    return n ? [sx / n, sy / n] : null;
  };
  const anchors: ([number, number] | null)[] = [
    centroid([468, 469, 470, 471, 472]),
    centroid([473, 474, 475, 476, 477]),
    pt(4),
    pt(152),
    pt(10),
    pt(14),
  ];
  g.strokeStyle = 'rgba(255, 222, 150, 0.95)';
  g.lineWidth = 1;
  g.shadowColor = 'rgba(248, 190, 90, 0.9)';
  g.shadowBlur = 6;
  for (const a of anchors) {
    if (!a) continue;
    g.beginPath();
    g.arc(a[0], a[1], 3.4, 0, 2 * Math.PI);
    g.stroke();
    g.beginPath();
    g.arc(a[0], a[1], 1, 0, 2 * Math.PI);
    g.fillStyle = 'rgba(255, 238, 200, 0.95)';
    g.fill();
  }
  g.shadowBlur = 0;

  // HUD chrome: hairline inset, corner brackets, mono caption.
  const m = 6;
  const bracket = 16;
  g.strokeStyle = 'rgba(250, 210, 130, 0.85)';
  g.lineWidth = 1.6;
  const corners: [number, number, number, number][] = [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    g.beginPath();
    g.moveTo(cx + dx * bracket, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + dy * bracket);
    g.stroke();
  }
  g.font = `${Math.max(9, Math.round(h * 0.016))}px ui-monospace, monospace`;
  g.fillStyle = 'rgba(255, 244, 222, 0.92)';
  g.shadowColor = 'rgba(0, 0, 0, 0.8)';
  g.shadowBlur = 4;
  g.fillText(`${landmarks.length} LANDMARKS · ON DEVICE`, m + 8, h - m - 7);
  g.shadowBlur = 0;

  const url = out.toDataURL('image/webp', 0.9);
  return url.startsWith('data:image/webp')
    ? url
    : out.toDataURL('image/jpeg', 0.9);
}

// Demo: file -> runAnalysisV3 -> render. No framework, no server calls:
// everything below runs in this tab (models load lazily on first analyze).
import {
  isRunV3Failure,
  runAnalysisV3,
  skinSignalBands,
  type AnalysisV3,
} from '../src';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const fileInput = $('file') as HTMLInputElement;
const adultBox = $('adult') as HTMLInputElement;
const analyzeBtn = $('analyze') as HTMLButtonElement;
const statusEl = $('status');
const reportEl = $('report');

function setBusy(b: boolean, msg: string) {
  analyzeBtn.disabled = b || !fileInput.files?.[0] || !adultBox.checked;
  statusEl.textContent = msg;
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  statusEl.textContent = f
    ? `${f.name} · ${(f.size / 1024).toFixed(0)} KB`
    : 'Pick a clear front-facing photo, check the box, then Analyze.';
  setBusy(false, statusEl.textContent);
});
adultBox.addEventListener('change', () => setBusy(false, statusEl.textContent));

analyzeBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    setBusy(true, 'Loading models and analyzing… (first run downloads ~10 MB from CDN)');
    const t0 = performance.now();
    const result = await runAnalysisV3({ role: 'front', file }, { adultConfirmed: true });
    if (isRunV3Failure(result)) {
      setBusy(false, `Model load failed: ${result.message}`);
      return;
    }
    const ms = Math.round(performance.now() - t0);
    render(result.analysis);
    setBusy(false, `Done in ${ms} ms — everything ran locally in this tab.`);
  } catch (err) {
    setBusy(false, `Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  );
}

function bar(label: string, value: number, max = 10): string {
  return `<table>
    <tr><td style="width:130px">${esc(label)}</td>
    <td class="num" style="width:44px">${value.toFixed(1)}</td>
    <td><div class="bar"><i style="width:${(value / max) * 100}%"></i></div></td></tr>
  </table>`;
}

function render(a: AnalysisV3): void {
  reportEl.classList.remove('hidden');

  // Score panel
  const sp = $('scorePanel');
  if (a.score.status === 'scored') {
    const dims = Object.entries(a.score.dimensionDisplay)
      .map(([k, v]) => bar(k, v))
      .join('');
    const skin = a.skinQuality;
    const skinLine =
      skin?.status === 'estimated'
        ? `<p class="muted">Advisory — not in the score. Skin reference: <b>${skin.display?.toFixed(1)}/10</b>${a.faceShape ? ` · Face shape: <b>${esc(a.faceShape.estimate)}</b>` : ''}</p>`
        : a.faceShape
          ? `<p class="muted">Face shape: <b>${esc(a.faceShape.estimate)}</b></p>`
          : '';
    sp.innerHTML = `
      <div class="score">${a.score.compositeScore.toFixed(1)}<small> /10</small></div>
      <p class="muted">Rule-based aesthetic reference index — a product convention, not a percentile or objective beauty.</p>
      ${dims}
      ${skinLine}`;
  } else {
    sp.innerHTML = `<p class="noscore">No score.</p>
      <p class="muted">Reason: <code>${esc(a.score.reason)}</code> — the photo did not pass the strict quality gate, so no number is shown (by design).</p>`;
  }

  // Quality panel
  const q = a.photos[0].quality;
  const checks = Object.entries(q.checks)
    .map(([k, v]) => `<td>${esc(k)}</td><td class="num">${esc(String(v))}</td>`)
    .map((s) => `<tr>${s}</tr>`)
    .join('');
  $('qualityPanel').innerHTML = `<h3>Quality gate</h3><table>${checks}</table>`;

  // Skin panel
  const skin = a.skinQuality;
  const skinEl = $('skinPanel');
  if (!skin) {
    skinEl.innerHTML = '<h3>Skin signals</h3><p class="muted">Not computed for this outcome.</p>';
  } else if (skin.status === 'estimated' && skin.signals) {
    const bands = skinSignalBands(skin.signals);
    skinEl.innerHTML = `
      <h3>Skin signals (advisory)</h3>
      ${bar('texture fine', bands.texture * 10)}
      ${bar('evenness', bands.evenness * 10)}
      ${bar('sheen-free', bands.shine * 10)}
      <p class="muted">raw textureRel=${skin.signals.textureRel.toFixed(3)}, evenness=${skin.signals.evenness.toFixed(2)}, shine=${skin.signals.shine.toFixed(4)} · pixel statistics only, not dermatology.</p>`;
  } else {
    skinEl.innerHTML = `<h3>Skin signals</h3><p class="muted">Status: ${esc(skin.status)} ${(skin.reasons ?? []).map(esc).join(', ')}</p>`;
  }

  // Demographics panel
  const demo = a.demographics;
  const demoEl = $('demoPanel');
  if (!demo) {
    demoEl.innerHTML = '<h3>Age &amp; gender estimate</h3><p class="muted">Not computed for this outcome.</p>';
  } else if (demo.status === 'estimated') {
    demoEl.innerHTML = `
      <h3>Age &amp; gender estimate (advisory)</h3>
      <p><b>${esc(demo.gender)}</b> · <b>${esc(demo.ageBand)}</b> (${demo.ageYears} y) · model margin ${demo.genderMargin?.toFixed(3)}</p>
      <p class="muted">Local 96×96 model, rough appearance estimate — can simply be wrong; never affects the score.</p>`;
  } else {
    demoEl.innerHTML = `<h3>Age &amp; gender estimate</h3><p class="muted">Status: ${esc(demo.status)} ${(demo.reasons ?? []).map(esc).join(', ')}</p>`;
  }

  // Overlay + JSON
  const ref = a.photos[0].annotatedRef;
  $('overlayPanel').innerHTML = ref
    ? `<h3>Landmarks</h3><img class="overlay" alt="annotated landmarks" src="${ref}" />`
    : '';
  $('json').textContent = JSON.stringify(
    a,
    (k, v) => (k === 'annotatedRef' ? '<data url omitted>' : v),
    2
  );
}

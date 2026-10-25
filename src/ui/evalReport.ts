import type { EvaluationReport, VariantResult } from '../eval/runner';

const COLUMNS: [string, string, (r: VariantResult) => string][] = [
  ['variant', 'What is switched off', (r) => r.label],
  ['ms', 'GPU-synced frame time, median', (r) => r.frameMs.median.toFixed(2)],
  ['saved', 'Frame time saved vs. all effects (the effect’s cost)', (r) => (r.id === 'reference' ? '—' : signed(r.savedMs))],
  ['tris', 'Triangles drawn, shadow passes included', (r) => `${(r.triangles / 1000).toFixed(0)}k`],
  ['calls', 'Draw calls', (r) => r.drawCalls.toFixed(0)],
  ['changed', 'Pixels that change vs. all effects', (r) => (r.id === 'reference' ? '—' : `${(r.image.changed * 100).toFixed(1)}%`)],
  ['PSNR', 'Image similarity to all effects, dB', (r) => (r.id === 'reference' ? '—' : r.image.psnr >= 99 ? '∞' : r.image.psnr.toFixed(1))],
  ['contrast', 'RMS luminance contrast (visibility)', (r) => r.contrast.toFixed(3)],
  ['labels', 'Mask pixels identical to all effects', (r) => `${(r.labelAgreement * 100).toFixed(2)}%`],
  ['aligned', 'Worst frame: depth and mask agree on surface', (r) => `${(r.coverage * 100).toFixed(2)}%`],
];

function signed(ms: number): string {
  return `${ms >= 0 ? '+' : ''}${ms.toFixed(2)}`;
}

function cell(tag: 'td' | 'th', text: string, title?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (title) element.title = title;
  return element;
}

/** Shows an evaluation as a table over the viewport; calling again replaces it. */
export function showEvaluation(report: EvaluationReport): void {
  document.querySelector('#eval-report')?.remove();
  const section = document.createElement('section');
  section.id = 'eval-report';
  section.setAttribute('aria-label', 'Evaluation results');

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = `Evaluation · ${report.trajectory}`;
  const meta = document.createElement('p');
  meta.textContent = `${report.frames} poses · ${report.width}×${report.height} · ${report.repeats} timed renders per pose · ${report.renderer}`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'close';
  close.addEventListener('click', () => section.remove());
  header.append(title, close);

  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  COLUMNS.forEach(([name, help]) => head.append(cell('th', name, help)));
  const body = table.createTBody();
  for (const result of report.variants) {
    const row = body.insertRow();
    if (result.id === 'reference') row.className = 'reference';
    COLUMNS.forEach(([, , get]) => row.append(cell('td', get(result))));
  }
  section.append(header, meta, table);
  document.querySelector('#app')?.append(section);
}

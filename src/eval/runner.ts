import type { CaptureSize, CapturedFrame, RenderTiming } from '../core/capture';
import type { SimSettings } from '../core/settings';
import { duration, type Trajectory } from '../core/trajectory';
import { coverageAgreement, imageDifference, labelAgreement, mean, median, quantile, rmsContrast } from './metrics';
import { EFFECT_VARIANTS, REFERENCE_VARIANT, type EvalVariant } from './variants';

/** What the evaluation needs from the app. */
export interface EvalHost {
  readonly settings: SimSettings;
  applySettings(): void;
  /** Freezes time at `t` on the trajectory and syncs everything for a robot-camera render `height` pixels tall. */
  prepareFrame(trajectory: Trajectory, t: number, height: number): void;
  timeRgb(size: CaptureSize, repeats: number): RenderTiming;
  capture(size: CaptureSize): CapturedFrame;
  /** Triangles selected by level of detail for the last prepared frame. */
  lodTriangles(): number;
  readonly sceneId: string;
  readonly rendererName: string;
}

export interface EvalOptions {
  size: CaptureSize;
  /** Poses sampled evenly along the trajectory. */
  frames: number;
  /** Timed renders per frame (the median is kept). */
  repeats: number;
  variants?: readonly EvalVariant[];
}

export interface VariantResult {
  id: string;
  label: string;
  frameMs: { median: number; p95: number };
  /** Reference median minus this variant's: what the removed effect costs per frame. */
  savedMs: number;
  triangles: number;
  drawCalls: number;
  /** Triangles chosen by level of detail (scene geometry only, before shadow passes). */
  lodTriangles: number;
  /** Mean over frames of the difference to the reference image. */
  image: { meanAbs: number; psnr: number; changed: number };
  contrast: number;
  /** Worst frame: fraction of pixels where depth and mask agree on surface presence (should be 1). */
  coverage: number;
  /** Mean fraction of mask pixels identical to the reference's (1 unless geometry changed). */
  labelAgreement: number;
}

export interface EvaluationReport {
  scene: string;
  seed: number;
  trajectory: string;
  width: number;
  height: number;
  frames: number;
  repeats: number;
  renderer: string;
  date: string;
  variants: VariantResult[];
}

/** Copies `source` into `target` in place (one level of nesting), so UI bindings to `target` stay valid. */
function assignSettings(target: SimSettings, source: SimSettings): void {
  const t = target as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object') Object.assign(t[key] as object, value);
    else t[key] = value;
  }
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Renders every variant at the same frozen poses along `trajectory`, timing
 * the RGB render and comparing images and labels with the reference (the
 * first variant). Settings are restored afterwards, also on failure.
 */
export async function runEvaluation(
  host: EvalHost,
  trajectory: Trajectory,
  options: EvalOptions,
  onProgress: (message: string) => void,
): Promise<EvaluationReport> {
  const { size, frames, repeats } = options;
  if (frames < 1) throw new Error('frames must be at least 1');
  const variants = [REFERENCE_VARIANT, ...(options.variants ?? EFFECT_VARIANTS)];
  const total = duration(trajectory);
  const times = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : (total * i) / (frames - 1)));
  const saved = structuredClone(host.settings);
  const use = (variant: EvalVariant): void => {
    assignSettings(host.settings, saved);
    variant.apply(host.settings);
    host.applySettings();
  };
  const samples = variants.map(() => ({
    ms: [] as number[],
    triangles: [] as number[],
    drawCalls: [] as number[],
    lodTriangles: [] as number[],
    diffs: [] as ReturnType<typeof imageDifference>[],
    contrast: [] as number[],
    coverage: [] as number[],
    agreement: [] as number[],
  }));

  try {
    // Compile every configuration's shaders before anything is timed.
    for (const variant of variants) {
      use(variant);
      host.prepareFrame(trajectory, times[0], size.height);
      host.timeRgb(size, 2);
    }
    // Round-robin: all variants run at each pose before moving on, so GPU
    // clock ramps and thermal drift affect every variant alike.
    for (const [i, t] of times.entries()) {
      let reference: CapturedFrame | undefined;
      for (const [v, variant] of variants.entries()) {
        use(variant);
        host.prepareFrame(trajectory, t, size.height);
        const timing = host.timeRgb(size, repeats);
        const frame = host.capture(size);
        reference ??= frame;
        const sample = samples[v];
        sample.ms.push(timing.ms);
        sample.triangles.push(timing.triangles);
        sample.drawCalls.push(timing.drawCalls);
        sample.lodTriangles.push(host.lodTriangles());
        sample.contrast.push(rmsContrast(frame.rgb));
        sample.coverage.push(coverageAgreement(frame.depth, frame.semantic));
        sample.diffs.push(imageDifference(reference.rgb, frame.rgb));
        sample.agreement.push(labelAgreement(reference.semantic, frame.semantic));
      }
      onProgress(`Evaluating ${variants.length} variants: pose ${i + 1}/${frames}`);
      await nextTask();
    }
  } finally {
    assignSettings(host.settings, saved);
    host.applySettings();
  }

  const referenceMs = median(samples[0].ms);
  const results: VariantResult[] = variants.map((variant, v) => {
    const sample = samples[v];
    const frameMs = { median: median(sample.ms), p95: quantile(sample.ms, 0.95) };
    return {
      id: variant.id,
      label: variant.label,
      frameMs,
      savedMs: referenceMs - frameMs.median,
      triangles: median(sample.triangles),
      drawCalls: median(sample.drawCalls),
      lodTriangles: median(sample.lodTriangles),
      image: {
        meanAbs: mean(sample.diffs.map((d) => d.meanAbs)),
        psnr: mean(sample.diffs.map((d) => Math.min(d.psnr, 99))),
        changed: mean(sample.diffs.map((d) => d.changed)),
      },
      contrast: mean(sample.contrast),
      coverage: Math.min(...sample.coverage),
      labelAgreement: mean(sample.agreement),
    };
  });

  return {
    scene: host.sceneId,
    seed: saved.seed,
    trajectory: trajectory.name,
    width: size.width,
    height: size.height,
    frames,
    repeats,
    renderer: host.rendererName,
    date: new Date().toISOString(),
    variants: results,
  };
}

const CSV_COLUMNS: [string, (r: VariantResult) => number | string][] = [
  ['variant', (r) => r.id],
  ['label', (r) => r.label],
  ['frame_ms_median', (r) => r.frameMs.median.toFixed(3)],
  ['frame_ms_p95', (r) => r.frameMs.p95.toFixed(3)],
  ['saved_ms', (r) => r.savedMs.toFixed(3)],
  ['triangles', (r) => r.triangles],
  ['draw_calls', (r) => r.drawCalls],
  ['lod_triangles', (r) => r.lodTriangles],
  ['image_mean_abs', (r) => r.image.meanAbs.toFixed(3)],
  ['image_psnr_db', (r) => r.image.psnr.toFixed(2)],
  ['image_changed_fraction', (r) => r.image.changed.toFixed(4)],
  ['rms_contrast', (r) => r.contrast.toFixed(4)],
  ['label_coverage_min', (r) => r.coverage.toFixed(5)],
  ['label_agreement', (r) => r.labelAgreement.toFixed(5)],
];

export function reportToCsv(report: EvaluationReport): string {
  const escape = (v: number | string): string =>
    typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v);
  return (
    [
      CSV_COLUMNS.map(([name]) => name).join(','),
      ...report.variants.map((r) => CSV_COLUMNS.map(([, get]) => escape(get(r))).join(',')),
    ].join('\n') + '\n'
  );
}

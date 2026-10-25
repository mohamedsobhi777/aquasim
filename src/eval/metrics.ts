/** Image and label metrics for comparing rendering variants. All inputs are RGBA8 or float buffers of equal size. */

/** A channel differing by more than this (of 255) counts the pixel as changed. */
const CHANGED_THRESHOLD = 8;

export interface ImageDifference {
  /** Mean absolute difference per RGB channel, 0-255. */
  meanAbs: number;
  /** Peak signal-to-noise ratio in dB; Infinity for identical images. */
  psnr: number;
  /** Fraction of pixels where any RGB channel differs by more than CHANGED_THRESHOLD. */
  changed: number;
}

function assertSameLength(a: ArrayLike<number>, b: ArrayLike<number>): void {
  if (a.length !== b.length) throw new Error(`buffer sizes differ: ${a.length} vs ${b.length}`);
}

export function imageDifference(a: Uint8Array, b: Uint8Array): ImageDifference {
  assertSameLength(a, b);
  const pixels = a.length / 4;
  let abs = 0;
  let squared = 0;
  let changed = 0;
  for (let p = 0; p < pixels; p++) {
    let pixelChanged = false;
    for (let c = 0; c < 3; c++) {
      const d = a[p * 4 + c] - b[p * 4 + c];
      abs += Math.abs(d);
      squared += d * d;
      if (Math.abs(d) > CHANGED_THRESHOLD) pixelChanged = true;
    }
    if (pixelChanged) changed++;
  }
  const mse = squared / (pixels * 3);
  return {
    meanAbs: abs / (pixels * 3),
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    changed: changed / pixels,
  };
}

/** Standard deviation of luminance (0-1): a simple proxy for how much structure stays visible through the water. */
export function rmsContrast(rgb: Uint8Array): number {
  const pixels = rgb.length / 4;
  let sum = 0;
  let sumSquared = 0;
  for (let p = 0; p < pixels; p++) {
    const y = (0.2126 * rgb[p * 4] + 0.7152 * rgb[p * 4 + 1] + 0.0722 * rgb[p * 4 + 2]) / 255;
    sum += y;
    sumSquared += y * y;
  }
  const mean = sum / pixels;
  return Math.sqrt(Math.max(0, sumSquared / pixels - mean * mean));
}

/** Fraction of pixels where depth and mask agree on whether a labelled surface is present. */
export function coverageAgreement(depth: Float32Array, semantic: Uint8Array): number {
  if (depth.length * 4 !== semantic.length) throw new Error('depth and mask sizes differ');
  let agree = 0;
  for (let p = 0; p < depth.length; p++) if (depth[p] > 0 === semantic[p * 4] > 0) agree++;
  return agree / depth.length;
}

/** Fraction of pixels with the same class and instance id in two masks. */
export function labelAgreement(a: Uint8Array, b: Uint8Array): number {
  assertSameLength(a, b);
  const pixels = a.length / 4;
  let agree = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) agree++;
  }
  return agree / pixels;
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length;
}

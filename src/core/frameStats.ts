/** Rolling frame-time statistics (median and high percentile), as planned for evaluation. */
export class FrameStats {
  private readonly samples: number[] = [];

  constructor(private readonly capacity = 240) {}

  push(frameMs: number): void {
    this.samples.push(frameMs);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  percentile(p: number): number {
    return percentile(this.samples, p);
  }

  reset(): void {
    this.samples.length = 0;
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

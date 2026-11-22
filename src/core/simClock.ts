/**
 * Simulation time, decoupled from wall-clock time. Capture freezes the clock so
 * every render pass for a frame sees the same simulation state.
 */
export class SimClock {
  private time = 0;
  private paused = false;
  timeScale = 1;

  get now(): number {
    return this.time;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Advances by a wall-clock delta (seconds) and returns the simulated delta. */
  tick(wallDelta: number): number {
    if (this.paused) return 0;
    const dt = Math.min(wallDelta, 0.1) * this.timeScale;
    this.time += dt;
    return dt;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  set(time: number): void {
    this.time = time;
  }
}

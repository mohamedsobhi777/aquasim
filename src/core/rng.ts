/** Seeded PRNG (mulberry32) so scenes and trajectories are reproducible from a seed. */
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick: empty list');
      return items[Math.floor(next() * items.length)];
    },
    chance: (p) => next() < p,
  };
}

/** Smooth 2D value noise with fractal octaves, deterministic for a given seed. */
export function createValueNoise2D(seed: number): (x: number, y: number) => number {
  const rng = createRng(seed);
  const size = 256;
  const table = Float32Array.from({ length: size * size }, () => rng.next() * 2 - 1);
  const at = (ix: number, iy: number): number =>
    table[(((iy % size) + size) % size) * size + (((ix % size) + size) % size)];
  const fade = (t: number): number => t * t * (3 - 2 * t);

  const sample = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };

  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let octave = 0; octave < 4; octave++) {
      sum += amp * sample(x * freq, y * freq);
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };
}

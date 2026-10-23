import * as THREE from "three";

import type { RandomFunc } from "../types";

export function randRange(params: {
  a: number;
  b: number;
  randFn: RandomFunc;
}) {
  return params.a + (params.b - params.a) * params.randFn();
}

export function randMultipleWithMinDist(params: {
  a: number;
  b: number;
  d: number;
  N: number;
  randFn: RandomFunc;
}): number[] {
  const { a, b, d, N, randFn } = params;

  if (!Number.isInteger(N) || N < 0) {
    throw new RangeError("N must be a non-negative integer");
  }
  if (!(d >= 0)) {
    throw new RangeError("d must be >= 0");
  }
  if (!(b > a)) {
    throw new RangeError("b must be greater than a");
  }
  if (N === 0) {
    return [];
  }

  // Room left after setting aside the (N-1) gaps of size d.
  const free = b - a - (N - 1) * d;
  if (free <= 0) {
    throw new RangeError(
      `Impossible: need (N-1)*d < b-a, got ${(N - 1) * d} >= ${b - a}`,
    );
  }

  // 1) N uniform offsets in [0, free), sorted
  const offsets: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = randFn();
    offsets[i] = r * free;
  }
  offsets.sort((x, y) => x - y);

  // 2) shift the i-th offset by i*d, then move into [a, b)
  return offsets.map((x, i) => a + x + i * d);
}

export function projectPointOnVec(
  p: THREE.Vector3,
  a: THREE.Vector3,
  vecFromA: THREE.Vector3,
): THREE.Vector3 {
  return p.clone().sub(a).projectOnVector(vecFromA).add(a);
}

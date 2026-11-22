import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Instance matrix for a unit cylinder (radius 1, height 1, along +y) spanning a -> b. */
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.Matrix4 {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  if (length < 1e-6) throw new Error('cylinderBetween: endpoints coincide');
  const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.divideScalar(length));
  const center = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(center, rotation, new THREE.Vector3(radius, length, radius));
}

/** Short cylinder (ring/collar) centred at `at`, aligned with `tangent`. */
export function collarAt(at: THREE.Vector3, tangent: THREE.Vector3, radius: number, length: number): THREE.Matrix4 {
  const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, tangent.clone().normalize());
  return new THREE.Matrix4().compose(at, rotation, new THREE.Vector3(radius, length, radius));
}

export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: readonly THREE.Matrix4[],
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  mesh.name = name;
  mesh.count = matrices.length;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function gaussianSmooth(values: readonly number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 2.5);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, k) =>
    Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)),
  );
  return values.map((_, i) => {
    let sum = 0;
    let total = 0;
    weights.forEach((w, k) => {
      const j = Math.min(values.length - 1, Math.max(0, i + k - radius));
      sum += values[j] * w;
      total += w;
    });
    return sum / total;
  });
}

/**
 * Rests a stiff pipe on uneven ground: the profile follows a low-pass filtered
 * copy of the terrain and never goes below it, so short dips are bridged
 * (free spans) while long-wavelength terrain is followed. `stiffness` is the
 * smoothing sigma in samples.
 */
export function restPipeOnGround(ground: readonly number[], radius: number, stiffness = 4, rounds = 3): number[] {
  const floor = ground.map((g) => g + radius);
  let y = [...floor];
  for (let round = 0; round < rounds; round++) {
    y = gaussianSmooth(y, stiffness).map((v, i) => Math.max(floor[i], v));
  }
  return y;
}

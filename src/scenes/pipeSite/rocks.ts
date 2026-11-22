import * as THREE from 'three';
import { InstancedLod } from '../../core/lod';
import { createValueNoise2D, type Rng } from '../../core/rng';
import { patchUnderwater } from '../../core/water';
import { FIELD_SIZE } from './layout';

const ROCK_COUNT = 520;
const ROCK_CLUSTERS = 14;
/** Fraction of rocks placed in clusters (outcrops) rather than scattered. */
const CLUSTERED = 0.55;

/** Icosphere subdivision and the projected radius (pixels) down to which each rock level is used. */
const ROCK_LODS = [
  { detail: 3, minPixels: 28 },
  { detail: 1, minPixels: 7 },
  { detail: 0, minPixels: 0.75 },
];

/** Every detail level is displaced by the same noise, so the outline barely changes between levels. */
function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const noise = createValueNoise2D(seed);
  const p = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise(v.x * 1.7 + v.z, v.y * 1.7 - v.z);
    v.multiplyScalar(1 + 0.35 * n).multiply(new THREE.Vector3(1, 0.65, 1));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Boulders and gravel: scattered rocks plus a few clustered outcrops. */
export function createRocks(
  seed: number,
  rng: Rng,
  heightAt: (x: number, z: number) => number,
  allowsRock: (x: number, z: number, radius: number) => boolean,
): THREE.Object3D {
  const half = FIELD_SIZE / 2 - 4;
  const clusters = Array.from(
    { length: ROCK_CLUSTERS },
    () => new THREE.Vector2(rng.range(-half, half), rng.range(-half, half)),
  );
  const rocks: THREE.Matrix4[] = [];
  for (let attempt = 0; rocks.length < ROCK_COUNT && attempt < ROCK_COUNT * 10; attempt++) {
    const clustered = rng.chance(CLUSTERED);
    const cluster = rng.pick(clusters);
    const spread = rng.range(0.5, 7);
    const angle = rng.range(0, Math.PI * 2);
    const x = clustered ? cluster.x + Math.cos(angle) * spread : rng.range(-half, half);
    const z = clustered ? cluster.y + Math.sin(angle) * spread : rng.range(-half, half);
    // Outcrops have larger boulders near their centre.
    const scale = clustered
      ? rng.range(0.3, 2.4) * (1.2 - spread / 8)
      : rng.chance(0.85)
        ? rng.range(0.12, 0.5)
        : rng.range(0.7, 1.5);
    // Maximum radial displacement (1.35) times the largest axis scale (1.3).
    if (!allowsRock(x, z, scale * 1.35 * 1.3)) continue;
    rocks.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, heightAt(x, z) + scale * 0.15, z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3)),
        ),
        new THREE.Vector3(scale * rng.range(0.8, 1.3), scale, scale * rng.range(0.8, 1.3)),
      ),
    );
  }
  const rockMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 1 }));
  const rockLod = new InstancedLod(
    'rocks',
    ROCK_LODS.map(({ detail, minPixels }) => ({ geometry: rockGeometry(seed + 7, detail), minPixels })),
    rockMaterial,
    rocks,
  );
  return rockLod.group;
}

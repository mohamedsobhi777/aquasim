import * as THREE from 'three';
import { setVertexDeformation, type VertexDeformation } from '../../core/labelPasses';
import { InstancedLod } from '../../core/lod';
import { createValueNoise2D, type Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { legPoint } from './jacket';
import { CLASSES, FIELD_SIZE, JACKET, PADS, SEABED_Y } from './layout';

const ROCK_COUNT = 520;
const ROCK_CLUSTERS = 14;
/** Fraction of rocks placed in clusters (outcrops) rather than scattered. */
const CLUSTERED = 0.55;
const ROPE_LENGTH = 7;

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

export interface Debris {
  group: THREE.Group;
  update(time: number): void;
}

/**
 * `lines` are seabed lines (pipeline, umbilical) that rocks must not sit on;
 * the first one is also used to place man-made debris nearby.
 */
export function createDebris(
  seed: number,
  rng: Rng,
  heightAt: (x: number, z: number) => number,
  lines: readonly THREE.Curve<THREE.Vector3>[],
): Debris {
  const group = new THREE.Group();
  group.name = 'debris';
  const half = FIELD_SIZE / 2 - 4;
  const [avoid] = lines;
  const lineSamples = lines.flatMap((line) => line.getSpacedPoints(Math.ceil(line.getLength() / 1.5)));
  const clearOfStructures = (x: number, z: number, margin: number): boolean =>
    PADS.every((pad) => Math.hypot(x - pad.center.x, z - pad.center.y) > pad.radius * 0.9 + margin) &&
    lineSamples.every((p) => Math.hypot(p.x - x, p.z - z) > 1.5 + margin);

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
    if (!clearOfStructures(x, z, scale)) continue;
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
  tagSemantic(rockLod.group, CLASSES.rock.id);
  group.add(rockLod.group);

  // Man-made debris near the structures: tyres, drums, a lost scaffold tube.
  const debrisMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x3d3b38, roughness: 0.85 }));
  const drumMaterial = patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0x8c4a2a, roughness: 0.7, metalness: 0.3 }),
  );
  const placeNear = (): THREE.Vector3 => {
    const site = rng.int(0, 2);
    const p =
      site === 0
        ? avoid.getPointAt(rng.range(0.1, 0.9))
        : new THREE.Vector3(PADS[site - 1].center.x, 0, PADS[site - 1].center.y);
    const angle = rng.range(0, Math.PI * 2);
    const r = site === 0 ? rng.range(3, 8) : rng.range(PADS[site - 1].radius * 0.75, PADS[site - 1].radius * 1.1);
    const x = p.x + Math.cos(angle) * r;
    const z = p.z + Math.sin(angle) * r;
    return new THREE.Vector3(x, heightAt(x, z), z);
  };
  const items: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.17, 12, 28), debrisMaterial);
    tyre.name = `tyre-${i}`;
    tyre.position.copy(placeNear()).add(new THREE.Vector3(0, 0.12, 0));
    tyre.rotation.set(Math.PI / 2 + rng.range(-0.2, 0.2), 0, rng.range(0, Math.PI));
    items.push(tyre);
  }
  for (let i = 0; i < 4; i++) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20), drumMaterial);
    drum.name = `drum-${i}`;
    drum.position.copy(placeNear()).add(new THREE.Vector3(0, 0.27, 0));
    drum.rotation.set(Math.PI / 2, 0, rng.range(0, Math.PI));
    items.push(drum);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 6, 8), drumMaterial);
  tube.name = 'scaffold-tube';
  tube.position.copy(placeNear()).add(new THREE.Vector3(0, 0.05, 0));
  tube.rotation.set(Math.PI / 2, 0, rng.range(0, Math.PI));
  items.push(tube);

  // A loose rope hanging from a brace, swaying in the current. Its deformation
  // is shared with the label passes so masks follow the moving geometry.
  const ropeTime = { value: 0 };
  const deformation: VertexDeformation = {
    pars: 'uniform float uRopeTime;',
    body: /* glsl */ `
      float hang = clamp( -transformed.y / ${ROPE_LENGTH.toFixed(1)}, 0.0, 1.0 );
      float sway = hang * hang;
      transformed.x += sway * ( 0.9 + 0.5 * sin( uRopeTime * 0.9 + transformed.y * 0.6 ) );
      transformed.z += sway * 0.45 * cos( uRopeTime * 0.7 + transformed.y * 0.45 );
    `,
    uniforms: { uRopeTime: ropeTime },
  };
  const ropeGeometry = new THREE.CylinderGeometry(0.035, 0.035, ROPE_LENGTH, 6, 48);
  ropeGeometry.translate(0, -ROPE_LENGTH / 2, 0);
  const rope = new THREE.Mesh(
    ropeGeometry,
    patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xc9b37a, roughness: 0.9 }), deformation),
  );
  rope.name = 'loose-rope';
  setVertexDeformation(rope, deformation);
  const braceY = SEABED_Y + JACKET.levels[1];
  rope.position.copy(legPoint(1, braceY).lerp(legPoint(2, braceY), 0.4)).add(new THREE.Vector3(0, -0.3, 0));
  // Deformation runs in object space; keep the rope's bounds generous so it is not culled mid-sway.
  rope.frustumCulled = false;
  items.push(rope);

  items.forEach((item) => {
    item.castShadow = item.receiveShadow = true;
    tagSemantic(item, CLASSES.debris.id);
    group.add(item);
  });

  return {
    group,
    update: (time) => {
      ropeTime.value = time;
    },
  };
}

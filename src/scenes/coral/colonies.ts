import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { CLASSES, FIELD_SIZE } from './layout';
import { brainCoral_generate, branchingCoral_generate } from './reef';

const PATCH_COUNT = 5;
/** Colonies cluster within this radius of a patch centre. */
const PATCH_RADIUS = 5;
const BRANCHING_COUNT = 70;
const BRAIN_COUNT = 14;
/** Brain coral resolution until LOD levels exist (about 55k triangles each instead of 320k). */
const BRAIN_SEGMENTS = 160;
/** Corals grow mostly upward, partly following the slope. */
const SLOPE_FOLLOW = 0.4;
const PLACEMENT_ATTEMPTS = 40;

const BRANCHING_COLORS = ['#b5734f', '#8e5a8a', '#c99a5b', '#6f7d5a'];
const BRAIN_COLORS = ['#8aa04a', '#b59a5a', '#7b8c6a'];

export type ColonyKind = 'branching' | 'brain';

export interface Colony {
  kind: ColonyKind;
  mesh: THREE.Mesh;
  /** Where the colony meets the seabed. */
  base: THREE.Vector3;
  /** Rough footprint radius, metres. */
  radius: number;
  height: number;
}

function slopeNormal(heightAt: (x: number, z: number) => number, x: number, z: number): THREE.Vector3 {
  const e = 0.25;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
}

/**
 * Picks a free spot near a random patch centre, keeping colonies from
 * overlapping. Returns null if the patch is too crowded.
 */
function placeColony(rng: Rng, patches: readonly THREE.Vector2[], placed: readonly Colony[], radius: number) {
  const limit = FIELD_SIZE / 2 - 4;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const centre = rng.pick(patches);
    const angle = rng.range(0, Math.PI * 2);
    // sqrt keeps the density even across the patch disk.
    const r = PATCH_RADIUS * Math.sqrt(rng.next());
    const x = THREE.MathUtils.clamp(centre.x + Math.cos(angle) * r, -limit, limit);
    const z = THREE.MathUtils.clamp(centre.y + Math.sin(angle) * r, -limit, limit);
    const free = placed.every((c) => Math.hypot(c.base.x - x, c.base.z - z) > (c.radius + radius) * 0.9);
    if (free) return new THREE.Vector2(x, z);
  }
  return null;
}

function coralMaterial(color: string): THREE.MeshStandardMaterial {
  return patchUnderwater(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
}

/** Scatters Linh's branching and brain corals over a few reef patches. */
export function createColonies(
  seed: number,
  rng: Rng,
  heightAt: (x: number, z: number) => number,
): { group: THREE.Group; colonies: Colony[] } {
  const group = new THREE.Group();
  group.name = 'corals';
  const patches = Array.from(
    { length: PATCH_COUNT },
    () => new THREE.Vector2(rng.range(-FIELD_SIZE / 3, FIELD_SIZE / 3), rng.range(-FIELD_SIZE / 3, FIELD_SIZE / 3)),
  );
  const colonies: Colony[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  const add = (
    kind: ColonyKind,
    index: number,
    radius: number,
    build: (base: THREE.Vector3, normal: THREE.Vector3) => THREE.Mesh,
    height: number,
  ): void => {
    const spot = placeColony(rng, patches, colonies, radius);
    if (!spot) return;
    // Sink the base a little so it never floats on a slope.
    const base = new THREE.Vector3(spot.x, heightAt(spot.x, spot.y) - 0.03, spot.y);
    const normal = up
      .clone()
      .lerp(slopeNormal(heightAt, spot.x, spot.y), SLOPE_FOLLOW)
      .normalize();
    const mesh = build(base, normal);
    mesh.name = `${kind}-coral-${index}`;
    mesh.castShadow = mesh.receiveShadow = true;
    tagSemantic(mesh, kind === 'brain' ? CLASSES.brainCoral.id : CLASSES.branchingCoral.id);
    group.add(mesh);
    colonies.push({ kind, mesh, base, radius, height });
  };

  // Brain corals first: they are larger and need the space.
  for (let i = 0; i < BRAIN_COUNT; i++) {
    const xSize = rng.range(0.45, 1.1);
    const zSize = xSize * rng.range(0.85, 1.15);
    const height = Math.min(xSize, zSize) * rng.range(0.4, 0.6);
    const color = rng.pick(BRAIN_COLORS);
    add(
      'brain',
      i,
      Math.max(xSize, zSize) / 2,
      (base, normal) =>
        brainCoral_generate({
          root_pt: base,
          root_normalVec: normal,
          x_size: xSize,
          z_size: zSize,
          height,
          material: coralMaterial(color),
          seedHash: `${seed}/coral/brain/${i}`,
          segments: BRAIN_SEGMENTS,
        }),
      height,
    );
  }

  for (let i = 0; i < BRANCHING_COUNT; i++) {
    const height = rng.range(0.45, 1.1);
    const color = rng.pick(BRANCHING_COLORS);
    add(
      'branching',
      i,
      height * 0.55,
      (base, normal) =>
        branchingCoral_generate({
          root_pt: base,
          root_normalVec: normal,
          root_distToCeil: height,
          root_radius: 0.018 * Math.sqrt(height),
          growthLevelCnt: 3,
          material: coralMaterial(color),
          seedHash: `${seed}/coral/branching/${i}`,
        }),
      height,
    );
  }

  return { group, colonies };
}

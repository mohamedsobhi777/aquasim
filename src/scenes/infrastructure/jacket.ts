import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { patchUnderwater } from '../../core/water';
import { cylinderBetween, collarAt, instanced } from './geometry';
import { CLASSES, JACKET, SEABED_Y } from './layout';
import { makeFoulingTexture } from './textures';

/** Leg corner signs, in order around the jacket (so neighbours share a face). */
const CORNERS: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Point on a battered (inclined) leg at world height y. */
export function legPoint(corner: number, y: number): THREE.Vector3 {
  const [sx, sz] = CORNERS[corner];
  const k = (y - SEABED_Y) / (JACKET.topY - SEABED_Y);
  const half = THREE.MathUtils.lerp(JACKET.baseHalfWidth, JACKET.topHalfWidth, k);
  return new THREE.Vector3(JACKET.center.x + sx * half, y, JACKET.center.y + sz * half);
}

/** Horizontal unit vector pointing away from the jacket axis through a leg. */
export function legOutward(corner: number): THREE.Vector3 {
  const [sx, sz] = CORNERS[corner];
  return new THREE.Vector3(sx, 0, sz).normalize();
}

export function createJacket(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'jacket';
  const steel = patchUnderwater(
    new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.2,
      map: makeFoulingTexture(
        rng,
        { base: '#8a8f7c', blotches: ['#5d6b3c', '#a0623a', '#c9c3a8', '#4a5a40'], blotchCount: 220, grain: 0.12 },
        [2, 8],
      ),
    }),
  );
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
  const levels = JACKET.levels.map((h) => SEABED_Y + h);

  const legs = CORNERS.map((_, c) =>
    cylinderBetween(legPoint(c, SEABED_Y - 2), legPoint(c, JACKET.topY), JACKET.legRadius),
  );
  // Thicker node cans where braces meet the legs.
  const cans = levels.flatMap((y) =>
    CORNERS.map((_, c) => {
      const axis = legPoint(c, y + 1).sub(legPoint(c, y - 1));
      return collarAt(legPoint(c, y), axis, JACKET.legRadius * 1.18, 1.8);
    }),
  );
  const legMesh = instanced(cylinder, steel, [...legs, ...cans], 'jacket-legs');
  tagSemantic(legMesh, CLASSES.jacketLeg.id);

  const braces: THREE.Matrix4[] = [];
  levels.forEach((y, li) => {
    CORNERS.forEach((_, c) => {
      const next = (c + 1) % CORNERS.length;
      braces.push(cylinderBetween(legPoint(c, y), legPoint(next, y), JACKET.braceRadius));
      if (li + 1 < levels.length) {
        const y2 = levels[li + 1];
        braces.push(cylinderBetween(legPoint(c, y), legPoint(next, y2), JACKET.braceRadius * 0.85));
        braces.push(cylinderBetween(legPoint(next, y), legPoint(c, y2), JACKET.braceRadius * 0.85));
      }
    });
  });
  // Plan diagonals on the lowest level.
  braces.push(cylinderBetween(legPoint(0, levels[0]), legPoint(2, levels[0]), JACKET.braceRadius));
  const braceMesh = instanced(cylinder, steel, braces, 'jacket-braces');
  tagSemantic(braceMesh, CLASSES.jacketBrace.id);

  const mudmatMaterial = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x7c7a70, roughness: 0.9 }));
  const mudmats = CORNERS.map((_, c) => {
    const p = legPoint(c, SEABED_Y + 0.15);
    return new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(4, 0.4, 4));
  });
  const mudmatMesh = instanced(new THREE.BoxGeometry(1, 1, 1), mudmatMaterial, mudmats, 'mudmats');
  tagSemantic(mudmatMesh, CLASSES.mudmat.id);

  group.add(legMesh, braceMesh, mudmatMesh);
  return group;
}

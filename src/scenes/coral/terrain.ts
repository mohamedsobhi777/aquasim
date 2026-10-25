import * as THREE from 'three';
import { createTerrainLod } from '../../core/terrainLod';
import { patchUnderwater } from '../../core/water';
import { createValueNoise2D, type Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { makeFoulingTexture } from '../../core/textures';
import { CLASSES, FIELD_SIZE, SEABED_Y } from './layout';

const CHUNKS = 6;
const LEVEL_SEGMENTS = [48, 24, 12, 6];
const MAX_ERROR_PIXELS = 1.5;

export interface ReefSeabed {
  object: THREE.Object3D;
  heightAt(x: number, z: number): number;
}

/** Sand with low mounds and ripples, and darker rubble where the noise says so. */
export function createReefSeabed(seed: number, rng: Rng): ReefSeabed {
  const broad = createValueNoise2D(seed + 11);
  const detail = createValueNoise2D(seed + 12);
  const rippleAngle = rng.range(0, Math.PI);
  const ripple = new THREE.Vector2(Math.cos(rippleAngle), Math.sin(rippleAngle));

  const heightAt = (x: number, z: number): number =>
    SEABED_Y +
    1.6 * broad(x * 0.035, z * 0.035) +
    0.3 * detail(x * 0.16, z * 0.16) +
    0.04 * Math.sin((x * ripple.x + z * ripple.y) * 3.1 + 0.8 * detail(x * 0.4, z * 0.4));

  const sand = new THREE.Color(0xd8cdb0);
  const rubble = new THREE.Color(0x8f8670);
  const colorAt = (x: number, z: number, target: THREE.Color): THREE.Color =>
    target.lerpColors(sand, rubble, THREE.MathUtils.smoothstep(detail(x * 0.06 + 30, z * 0.06) * 2.2, 0.1, 0.9));

  const material = patchUnderwater(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      map: makeFoulingTexture(
        rng,
        { base: '#ece6d6', blotches: ['#c9bfa4', '#b3a88d', '#f7f3ea'], blotchCount: 220, grain: 0.22 },
        [24, 24],
      ),
    }),
  );

  const { group } = createTerrainLod({
    name: 'sand',
    size: FIELD_SIZE,
    heightAt,
    colorAt,
    material,
    chunks: CHUNKS,
    levelSegments: LEVEL_SEGMENTS,
    maxErrorPixels: MAX_ERROR_PIXELS,
  });
  tagSemantic(group, CLASSES.sand.id);
  return { object: group, heightAt };
}

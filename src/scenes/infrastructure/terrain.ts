import * as THREE from 'three';
import { createTerrainLod } from '../../core/terrainLod';
import { patchUnderwater } from '../../core/water';
import { createValueNoise2D, type Rng } from '../../core/rng';
import { tagSemantic } from '../../core/semantics';
import { CLASSES, FIELD_SIZE, PADS, SEABED_Y } from './layout';
import { makeFoulingTexture } from './textures';

/** 8 x 8 chunks; the finest level matches the old single 220 x 220 grid closely (0.66 m spacing). */
const CHUNKS = 8;
const LEVEL_SEGMENTS = [32, 16, 8, 4];
/** Chunks drop detail once their height error would cover fewer pixels than this. */
const MAX_ERROR_PIXELS = 1.5;

export interface Seabed {
  object: THREE.Object3D;
  heightAt(x: number, z: number): number;
}

export function createSeabed(seed: number, rng: Rng): Seabed {
  const broad = createValueNoise2D(seed);
  const detail = createValueNoise2D(seed + 1);
  const rippleAngle = rng.range(0, Math.PI);
  const rippleDir = new THREE.Vector2(Math.cos(rippleAngle), Math.sin(rippleAngle));

  const heightAt = (x: number, z: number): number => {
    const natural =
      SEABED_Y +
      2.2 * broad(x * 0.018, z * 0.018) +
      0.45 * detail(x * 0.09, z * 0.09) +
      0.05 * Math.sin((x * rippleDir.x + z * rippleDir.y) * 2.4 + 0.6 * detail(x * 0.3, z * 0.3));
    // Level the seabed under installed structures.
    let k = 1;
    for (const pad of PADS) {
      const d = Math.hypot(x - pad.center.x, z - pad.center.y);
      k = Math.min(k, THREE.MathUtils.smoothstep(d, pad.radius * 0.6, pad.radius));
    }
    return SEABED_Y + (natural - SEABED_Y) * k;
  };

  const sand = new THREE.Color(0xb8a98a);
  const silt = new THREE.Color(0x6f6a58);
  const colorAt = (x: number, z: number, target: THREE.Color): THREE.Color =>
    target.lerpColors(sand, silt, THREE.MathUtils.clamp(0.5 + detail(x * 0.05 + 40, z * 0.05) * 1.6, 0, 1));

  const material = patchUnderwater(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      map: makeFoulingTexture(rng, { base: '#d9d2c0', blotches: ['#a39a83', '#8c8470', '#efe9da'], blotchCount: 160, grain: 0.18 }, [40, 40]),
    }),
  );

  const { group } = createTerrainLod({
    name: 'seabed',
    size: FIELD_SIZE,
    heightAt,
    colorAt,
    material,
    chunks: CHUNKS,
    levelSegments: LEVEL_SEGMENTS,
    maxErrorPixels: MAX_ERROR_PIXELS,
  });
  tagSemantic(group, CLASSES.seabed.id);
  return { object: group, heightAt };
}

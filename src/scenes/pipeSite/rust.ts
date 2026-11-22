import * as THREE from 'three';
import { createRng, createValueNoise2D } from '../../core/rng';

/** White leaves the steel colour visible. Ochre edges surround darker oxide patches. */
export function makeRustMap(seed: number): THREE.DataTexture {
  const noise = createValueNoise2D(seed);
  const rng = createRng(seed);
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      // Sample around a torus so both edges of the UV tile meet without seams.
      const a = 2 * Math.PI * u,
        b = 2 * Math.PI * v;
      const ring = 6 + 2 * Math.cos(b);
      const n = noise(ring * Math.cos(a), ring * Math.sin(a) + 3 * Math.sin(b));
      const grain = rng.next();
      const cover = THREE.MathUtils.smoothstep(n + 0.09 * (grain - 0.5), 0.03, 0.18);
      const dark = THREE.MathUtils.smoothstep(n, 0.15, 0.48);
      const i = (y * size + x) * 4;
      pixels[i] = 255 - cover * (24 + 55 * dark + 20 * grain);
      pixels[i + 1] = 255 - cover * (126 + 43 * dark + 21 * grain);
      pixels[i + 2] = 255 - cover * (190 + 24 * dark + 15 * grain);
      pixels[i + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}
